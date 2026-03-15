const express = require('express');
const app = express();
app.use(express.json());

const API_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL   = 'gpt-4.1-mini';
const MAX_STAT_GAIN = 5;
const MAX_HP_DELTA  = 50;
const MAX_XP_GAIN   = 200;

function key() { return process.env.OPENAI_API_KEY; }

async function callAI(messages, maxTokens, temp) {
  const r = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: maxTokens || 600,
      temperature: temp || 0.85,
    })
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  return d.choices?.[0]?.message?.content || '';
}

function buildNPCContext(npcs) {
  if (!npcs || !Object.keys(npcs).length) return '';
  let s = '\nKNOWN NPCs (appearance, personality, age NEVER change):\n';
  for (const [name, n] of Object.entries(npcs)) {
    s += `- ${name}: attitude=${n.attitude||'unknown'}, level=${n.level||'?'}, race=${n.race||'?'}, age=${n.age||'?'}`;
    if (n.appearance) s += `, appearance=${n.appearance}`;
    s += '\n';
    if (n.history)     s += `  history: ${n.history}\n`;
    if (n.itemsTraded) s += `  items traded: ${n.itemsTraded}\n`;
    if (n.promises)    s += `  promises: ${n.promises}\n`;
    if (n.betrayals)   s += `  betrayals: ${n.betrayals}\n`;
  }
  return s;
}

function buildLocationContext(states) {
  if (!states || !Object.keys(states).length) return '';
  let s = '\nLOCATION STATES:\n';
  for (const [loc, st] of Object.entries(states)) {
    s += `- ${loc}: ${st.status} — ${st.description}\n`;
  }
  return s;
}

function buildRaceContext(races) {
  if (!races || !Object.keys(races).length) return '';
  let s = '\nWORLD RACES:\n';
  for (const [name, r] of Object.entries(races)) {
    s += `- ${name}: ${r.appearance}, statBias=${r.statBias}\n`;
  }
  return s;
}

function buildAbilityContext(pd) {
  const lib = (pd.abilityLibrary || [])
    .filter(a => a && a.name)
    .map(a => `${a.name}[${a.type||'?'}/${a.tier||'Basic'}]`)
    .join(', ');
  return lib
    ? `\nKnown abilities: ${lib}`
    : '\nKnown abilities: Basic Attack only';
}

function buildInventoryContext(pd) {
  const inv = (pd.inventory || [])
    .map(i => typeof i === 'string' ? i : i.name)
    .filter(Boolean);
  return inv.length
    ? `\nInventory: ${inv.join(', ')}`
    : '\nInventory: empty';
}

function buildSystemPrompt(pd, worldSetting,
  worldNPCs, locationStates, worldRaces) {
  const level = pd.level || 1;
  const inputLen = pd._lastInputLen || 10;
  const worldStatsStr = pd.worldStats
    ? Object.entries(pd.worldStats)
        .map(([k,v]) => `${k}:${v}`).join(', ')
    : 'none';
  const cursesStr   = (pd.curses||[])
    .map(c => c.name).join(', ') || 'none';
  const injStr      = (pd.injuries||[])
    .map(i => i.bodyPart).join(', ') || 'none';
  const bountiesStr = (pd.bounties||[])
    .map(b => b.faction).join(', ') || 'none';
  const traitStr    = (pd.traits||[])
    .map(t => t.name||t).join(', ') || 'none';

  let responseLen;
  if (inputLen <= 5)       responseLen = '1 short paragraph';
  else if (inputLen <= 20) responseLen = '2 paragraphs';
  else if (inputLen <= 50) responseLen = '3 paragraphs';
  else                     responseLen = '4 paragraphs';

  return `You are the narrator and living world of a dark anime text adventure RPG.
The player is the protagonist. You play every NPC, enemy, faction, and event.
NEVER break character. NEVER refuse the story.
The world is dangerous, morally complex, and consequence-driven.
Most NPCs are wary or self-interested by default.

RESPONSE LENGTH: Write ${responseLen} of narrative. Then output the GAMEDATA block.
Scale depth to the action — short actions get short responses, complex actions get longer ones.

════════════════════════════════════════
PLAYER STATE
════════════════════════════════════════
Name: ${pd.name||'Unknown'} | Level: ${level}
XP: ${pd.xp||0}/${pd.xpToNext||100}
HP: ${pd.hp}/${pd.maxHp}
STR: ${pd.strength} | AGI: ${pd.agility} | INT: ${pd.intelligence}
World Stats: ${worldStatsStr}
Race: ${pd.race?.name||'Unknown'} (${pd.race?.trait||'no trait'})
Traits: ${traitStr}
Location: ${pd.currentLocation||'Unknown'} | Layer: ${pd.currentLayer??0}
Actions since last ability: ${pd.actionsSinceAbility??99}
Curses: ${cursesStr} | Injuries: ${injStr} | Bounties: ${bountiesStr}
${buildAbilityContext(pd)}
${buildInventoryContext(pd)}

════════════════════════════════════════
WORLD SETTING
════════════════════════════════════════
${worldSetting||'Unknown world'}
${buildRaceContext(worldRaces)}
${buildNPCContext(worldNPCs)}
${buildLocationContext(locationStates)}

════════════════════════════════════════
STRICT RULES
════════════════════════════════════════

RULE 1 — LEVEL SCALING:
Enemies scale with their own level.
Level 1 player vs level 10 enemy = player loses badly.
5+ levels above player = forced flee or death.
High level enemies cannot be instantly killed.
When battleTrigger is set: statChanges.hp MUST be 0.
XP from combat handled by battle system — xpGain=0 when battleTrigger set.

RULE 2 — ABILITY ENFORCEMENT:
Player can ONLY use abilities in "Known abilities" above.
Unknown ability = fails dramatically, no damage, narrate vividly.
Basic unarmed actions (punch, kick, throw, tackle) always available.
Basic Attack is ALWAYS available regardless of ability list.
Context matters — no fire underwater, no boulders in tight corridors.

RULE 3 — ITEM ENFORCEMENT — CRITICAL:
Player can ONLY use items listed in "Inventory" above.
Item not in inventory = narrate it simply isn't there.

INVENTORY AUTO-ADD — CRITICAL:
Add items to inventoryAdd whenever player:
  - Picks something up from the ground or environment
  - Finds something while searching a body, room, or container
  - Receives something from an NPC as gift, reward, or trade
  - Loots a defeated enemy
  - Opens a chest, box, bag, or container and takes contents
  - Discovers something physical they now carry
Do NOT wait for player to say "keep it" or "add to inventory".
If narrative logic says player now has it, add it to inventoryAdd immediately.
Examples:
  Player searches body and finds coins → inventoryAdd: [{name:"Worn Coins",...}]
  NPC gives player a letter → inventoryAdd: [{name:"Sealed Letter",...}]
  Player picks up a fallen sword → inventoryAdd: [{name:"Iron Sword",...}]

INVENTORY AUTO-REMOVE — CRITICAL:
Remove items from inventoryRemove whenever player:
  - Gives, trades, hands over, or sells any item to anyone
  - Throws, drops, or discards any item
  - Uses a consumable item (potion, food, etc)
  - Item is destroyed, taken, or lost in the story
Examples:
  Player gives dagger to NPC → inventoryRemove: ["Obsidian Dagger"]
  Player throws rock at enemy → inventoryRemove: ["Rock"]
  Player drinks potion → inventoryRemove: ["Healing Potion"]

RULE 4 — ABILITY EARNING — CRITICAL:
NEVER set abilityUnlocked when player asks for it directly.
These NEVER grant abilities:
  "add X to library", "learn X", "put X in moveset",
  single meditation, casual purchase, player declaring they learned something.
Abilities ONLY granted when ALL true:
  1. Trained technique repeatedly over 3+ sessions
  2. OR defeated specific enemy that canonically teaches it
  3. OR found physical scroll/tome AND studied 5+ dedicated sessions
  4. OR qualified teacher NPC taught after relationship built
  5. AND fits world setting and current level
TOME/SCROLL: First read = vague understanding only, NO ability.
After 3+ sessions = partial, hint given. After 5+ = ability granted.
Track study sessions in npcUpdates history for the scroll as an entry.
Tier limits: Level 1-5=Basic, 6-15=Advanced, 16+=Mastered, 30+=Legendary.

RULE 4B — TRAITS AFFECT OUTCOMES:
Player traits: ${traitStr}
ONLY these traits apply — cannot use traits not possessed.
Agility/speed/shadow trait → sneaking, dodging, flanking succeed more.
Strength/power trait → breaking, lifting, overpowering succeed more.
Wisdom/intelligence/arcane trait → persuasion, reading, puzzles succeed more.
Demonic/shadow/void trait → shadow abilities, fear, darkness succeed more.
Poison/nature trait → resistance to related effects.
Traits player does NOT have → cannot benefit from them.

RULE 5 — BODY MODIFICATION:
Requires: item in inventory + appropriate level + willing NPC surgeon + narrative time.
If any missing: NPC refuses or procedure fails.

RULE 6 — NO INSTANT KILLS:
Enemies cannot be instantly killed regardless of ability or trait claims.
Powerful enemies need multiple turns. Boss = full battle required.

RULE 7 — NO TELEPORTATION:
Travel takes time proportional to distance.
Fast travel only if world has established systems.

RULE 8 — NPC MEMORY AND IDENTITY LOCK:
NPCs remember EVERYTHING from their history.
Betrayed NPC = always hostile. Helped NPC = always remembers.
IDENTITY LOCK: Appearance, personality, age, race NEVER change once set.
Only level can increase if encountered after long time.
Do NOT regenerate NPC descriptions — use saved history.

RULE 9 — WORLD CONSISTENCY:
Destroyed = stays destroyed. Dead = stays dead.
All consequences permanent and cumulative.

RULE 10 — ITEM THEME:
Items must fit the established world. No anachronisms.

RULE 11 — STAT CAP:
Max ${MAX_STAT_GAIN} stat points per action.
Max HP delta: ±${MAX_HP_DELTA}. Max XP: ${MAX_XP_GAIN}.

RULE 12 — BATTLE TRIGGER — CRITICAL:
battleTrigger MUST be set whenever combat begins for ANY reason.
NEVER narrate a fight without battleTrigger.
NEVER resolve combat damage in narrative.
When battleTrigger set: statChanges.hp = 0, xpGain = 0.

RULE 13 — NPC HIGHLIGHTS:
Every named NPC or enemy = nameHighlights entry.
friendly=green, hostile=red, unknown=white. Include level.

RULE 14 — LAYER CHANGES:
currentLayer: null if unchanged. Only set if player moved to different layer.

RULE 15 — TIMESKIP LIMIT:
Max 24 hours per action. Longer skips need multiple actions.

════════════════════════════════════════
RESPONSE FORMAT
════════════════════════════════════════
Write ${responseLen} of narrative ONLY.
Then output this block exactly:

<GAMEDATA>
{
  "statChanges": { "hp": 0, "strength": 0, "agility": 0, "intelligence": 0, "worldStats": {} },
  "xpGain": 0,
  "inventoryAdd": [],
  "inventoryRemove": [],
  "worldEvent": "",
  "currentLocation": "",
  "currentLayer": null,
  "reputationChanges": {},
  "abilityUsed": false,
  "abilityUnlocked": null,
  "traitGained": null,
  "bossKilled": false,
  "nearDeath": false,
  "playerDied": false,
  "npcUpdates": {},
  "locationStateChanges": {},
  "badEvent": null,
  "battleTrigger": null,
  "nameHighlights": []
}
</GAMEDATA>

FIELD RULES:
- statChanges.hp: DELTA only. MUST be 0 when battleTrigger set.
  NEVER put current HP (${pd.hp}) here.
- statChanges.worldStats: world-specific deltas e.g. {"QI": 2}
- xpGain: non-combat only. 0 when battleTrigger set. Cap ${MAX_XP_GAIN}.
- inventoryAdd: CRITICAL — add items here whenever player picks up, finds,
  receives, loots, or takes anything physical. Do NOT wait to be asked.
  Format: { "name": "Item Name", "description": "Brief origin under 10 words", "source": "Location or NPC" }
  OR plain string for very simple items.
- inventoryRemove: item name strings that LEFT player possession this action.
  ALWAYS include when player gives/trades/drops/throws/uses/loses any item.
- abilityUnlocked: null OR { name:"", description:"", type:"physical|demonic|divine|fire|ice|light|shadow|cursed|holy|chaos|order|arcane|nature|void", tier:"Basic", damage:"STR x 1.0", cooldown:0 }
- traitGained: null OR { name:"", description:"", source:"" }
- battleTrigger: null OR { enemyName:"", enemyLevel:1, enemyHp:100, enemyMaxHp:100, enemyStr:10, enemyAgi:10, enemyInt:10, enemyDominantStat:"strength", enemyDescription:"", enemyRace:"", isBoss:false }
- npcUpdates: { "Name": { attitude:"friendly|hostile|unknown", level:1, race:"", age:"", history:"", itemsTraded:"", promises:"", betrayals:"", appearance:"" } }
  appearance: set ONCE on first encounter, never change after.
- nameHighlights: [ { name:"", type:"npc|enemy", attitude:"friendly|hostile|unknown", level:1 } ]
- badEvent: null OR { type:"ambush|disaster|betrayal|curse|injury|bounty", description:"", details:{} }
- reputationChanges: { "FactionName": delta } always include faction when player kills/spares/helps/harms affiliated person.
- currentLocation: empty string if unchanged.
- currentLayer: null if unchanged.
CRITICAL REMINDER: You MUST end every response with the complete <GAMEDATA> block.
Never cut the response before GAMEDATA. GAMEDATA is required on every single response.`;
}

const WORLD_CREATION_PROMPT = `You are a world builder for a dark anime text adventure RPG.
Given a player's world description generate starting world data.
Return ONLY valid JSON, no markdown:
{
  "races": [
    {
      "name": "Race Name",
      "appearance": "Brief visible description",
      "statBias": "strength|agility|intelligence|balanced",
      "statBonus": { "strength": 0, "agility": 0, "intelligence": 0 },
      "trait": "Trait name",
      "traitDescription": "What the trait does passively"
    }
  ],
  "playerRace": {
    "name": "Race Name",
    "description": "One sentence",
    "statBonus": { "strength": 0, "agility": 0, "intelligence": 0 },
    "trait": "Trait Name",
    "traitDescription": "What the trait does passively"
  },
  "startingAbility": {
    "name": "Ability Name",
    "description": "What it does",
    "type": "physical|demonic|divine|fire|ice|light|shadow|cursed|holy|chaos|order|arcane|nature|void",
    "tier": "Basic",
    "damage": "STR x 1.0",
    "cooldown": 0
  },
  "startingLocation": "Location name",
  "openingNarrative": "2 paragraphs setting the scene vividly"
}
Rules:
- Generate 4-8 races fitting the world with varied appearances
- Player race randomly chosen — make it interesting
- Starting ability random, fits world theme, has actual damage formula
- statBonus total 2-4 points max
- Trait must be narratively meaningful with real passive effect`;

const BATTLE_PROMPT = `You are a battle resolver for a dark anime RPG.
Resolve ONE turn and return ONLY valid JSON, no markdown:
{
  "battleLog": "1-2 vivid sentences of what happened",
  "playerHpChange": 0,
  "enemyHpChange": 0,
  "battleEnded": false,
  "playerWon": false,
  "xpReward": 0,
  "itemDrop": ""
}
DAMAGE RULES:
- Physical abilities use STR for scaling
- Shadow/void/arcane/demonic use INT
- Speed/agility abilities use AGI
- Minimum damage per turn: 5
- Maximum: level * 8
- NEVER return enemyHpChange=0 on player turn unless explicitly missed
- isEnemyTurn=true: enemy attacks, playerHpChange negative, enemyHpChange=0
- isEnemyTurn=false: player attacks, enemyHpChange negative
- xpReward and itemDrop only when playerWon=true
- xpReward: 20 + (enemyLevel * 10), doubled for bosses
- battleEnded=true only when one side reaches 0 HP`;

const ENEMY_ABILITIES_PROMPT = `You are an ability generator for enemies in a dark anime RPG.
Generate 2-3 abilities fitting this enemy.
Return ONLY valid JSON, no markdown:
{
  "abilities": [
    {
      "name": "Ability Name",
      "description": "What it does in one sentence",
      "type": "physical|fire|ice|shadow|etc",
      "damage": "STR x 1.2",
      "cooldown": 0
    }
  ]
}
Rules:
- Must fit enemy type, race, and world setting
- Scale power to enemy level
- Always include one basic attack (cooldown 0)
- Cooldowns: basic=0, special=1-2, powerful=3
- Damage formula uses enemy dominant stat`;

const WORLD_EVENT_PROMPT = `You are a world event generator for a dark anime RPG.
Generate one passive world event while player was busy.
The world lives and changes without the player.
Return ONLY valid JSON, no markdown:
{
  "eventTitle": "Short evocative title",
  "eventDescription": "2-3 sentences describing what happened",
  "affectedLocation": "Location name from the world",
  "locationStatus": "attacked|ruined|thriving|locked|changed|reinforced|abandoned",
  "locationDescription": "New one sentence state of the location",
  "affectedFaction": "Faction name or empty string",
  "factionChange": 0,
  "severity": "minor|moderate|major",
  "badEventForPlayer": null
}
badEventForPlayer: null OR { type:"ambush|bounty", description:"" } — NEVER a boolean.`;

const MAP_PROMPT = `You are a world map generator for a dark anime RPG.
Return ONLY valid JSON, no markdown:
{
  "layer": 0,
  "layerName": "Ground",
  "locations": [
    {
      "id": "loc_1",
      "name": "Name",
      "type": "city|dungeon|wilderness|landmark|sanctuary|ruins|fortress|village|market|portal",
      "x": 45, "y": 32,
      "description": "One evocative sentence",
      "connections": ["loc_2"],
      "isStarting": false,
      "minLevel": 1
    }
  ]
}
Rules:
- 20-25 locations layer 0, 10-15 others
- x/y 0-100, 2-4 connections each
- Exactly ONE isStarting=true near center
- minLevel: starting=1, mid=5-10, dangerous=15-25
- Mix location types, atmospheric names`;

const INSPECT_PROMPT = `You are an NPC inspector for a dark anime RPG.
Reveal only what makes sense given their history.
Return ONLY valid JSON, no markdown:
{
  "name": "Full name or ???",
  "race": "Race or ???",
  "age": "Age estimate or ???",
  "level": 1,
  "appearance": "2 sentence physical description",
  "impression": "One sentence of what player senses",
  "attitude": "friendly|hostile|unknown"
}
Make appearance memorable and specific. Level reflects power and experience.`;

app.post('/story', async (req, res) => {
  try {
    const { messages, worldSetting, playerData,
            worldNPCs, locationStates,
            worldRaces, inputLength } = req.body;

    console.log(`Story | Lv${playerData?.level}`
      + ` | HP:${playerData?.hp}`
      + ` | ${playerData?.currentLocation}`
      + ` | inputLen:${inputLength||'?'}`);

    const pdWithLen = {
      ...playerData,
      _lastInputLen: inputLength || 10
    };

    const prompt = buildSystemPrompt(
      pdWithLen || {}, worldSetting,
      worldNPCs || {}, locationStates || {},
      worldRaces || {});

    let maxTok = 600;
    if ((inputLength||0) > 50) maxTok = 1000;
    else if ((inputLength||0) > 20) maxTok = 800;

    const raw = await callAI(
      [{ role:'system', content:prompt },
       ...(messages||[])],
      maxTok, 0.85);

    const match = raw.match(
      /<GAMEDATA>([\s\S]*?)<\/GAMEDATA>/);
    const narrative = raw
      .replace(/<GAMEDATA>[\s\S]*?<\/GAMEDATA>/g,'')
      .replace(/<GAMEDATA>[\s\S]*/g,'')
      .trim();

    let gd = {
      statChanges:{}, xpGain:0,
      inventoryAdd:[], inventoryRemove:[],
      worldEvent:'', currentLocation:'',
      currentLayer:null, reputationChanges:{},
      abilityUsed:false, abilityUnlocked:null,
      traitGained:null, bossKilled:false,
      nearDeath:false, playerDied:false,
      npcUpdates:{}, locationStateChanges:{},
      badEvent:null, battleTrigger:null,
      nameHighlights:[],
    };

    if (match) {
      try {
        gd = { ...gd,
          ...JSON.parse(match[1].trim()) };
      } catch(e) {
        console.error("GAMEDATA parse:", e.message);
      }
    } else {
      console.warn("No GAMEDATA in response");
    }

    // Server enforcement
    if (gd.statChanges) {
      let total = 0;
      for (const k of ['strength','agility','intelligence']) {
        if ((gd.statChanges[k]||0) > 0)
          total += gd.statChanges[k];
      }
      if (total > MAX_STAT_GAIN) {
        const ratio = MAX_STAT_GAIN / total;
        for (const k of ['strength','agility','intelligence']) {
          if ((gd.statChanges[k]||0) > 0)
            gd.statChanges[k] = Math.floor(gd.statChanges[k] * ratio);
        }
      }
      if (gd.statChanges.hp) {
        gd.statChanges.hp = Math.max(-MAX_HP_DELTA,
          Math.min(MAX_HP_DELTA, gd.statChanges.hp));
      }
      if (gd.battleTrigger && gd.battleTrigger.enemyName) {
        if ((gd.statChanges.hp || 0) < 0) {
          gd.statChanges.hp = 0;
        }
      }
    }

    if (gd.xpGain > MAX_XP_GAIN) gd.xpGain = MAX_XP_GAIN;
    if (gd.battleTrigger && gd.battleTrigger.enemyName) {
      gd.xpGain = 0;
    }

    if (gd.abilityUnlocked && gd.abilityUnlocked.name) {
      const lvl = playerData?.level || 1;
      const tierMin = { Basic:1, Advanced:6, Mastered:16, Legendary:30 };
      const tier = gd.abilityUnlocked.tier || 'Basic';
      if (lvl < (tierMin[tier] || 1)) {
        gd.abilityUnlocked.tier = 'Basic';
      }
    }

    if (gd.battleTrigger && !gd.battleTrigger.enemyName) {
      gd.battleTrigger = null;
    }

    if (typeof gd.badEvent === 'boolean') gd.badEvent = null;

    if (gd.currentLayer === 0
        && playerData?.currentLayer !== 0
        && playerData?.currentLayer != null) {
      gd.currentLayer = null;
    }

    // Normalize inventoryAdd to objects
    if (gd.inventoryAdd) {
      gd.inventoryAdd = gd.inventoryAdd.map(item => {
        if (typeof item === 'string') {
          return { name: item, description: '', source: '' };
        }
        return item;
      });
    }

    console.log("battleTrigger:", gd.battleTrigger?.enemyName || 'none');
    console.log("abilityUnlocked:", gd.abilityUnlocked?.name || 'none');
    console.log("inv+:", gd.inventoryAdd?.length || 0,
      "inv-:", gd.inventoryRemove?.length || 0);

    res.json({ narrative, gameData: gd });
  } catch(e) {
    console.error("Story error:", e.message);
    res.status(500).json({
      narrative: 'The void swallows your action.',
      gameData: {}
    });
  }
});

app.post('/create-world', async (req, res) => {
  try {
    const { worldDescription } = req.body;
    console.log("Creating world:", worldDescription?.slice(0,60));

    const raw = await callAI(
      [{ role:'system', content:WORLD_CREATION_PROMPT },
       { role:'user', content:`Create world for: ${worldDescription}` }],
      1000, 0.85);

    const clean = raw.replace(/```json/g,'').replace(/```/g,'').trim();
    let data;
    try { data = JSON.parse(clean); }
    catch(e) {
      console.error("World creation parse:", e.message);
      return res.status(500).json({ error:"Parse failed" });
    }

    res.json({ worldData: data });
  } catch(e) {
    console.error("World creation:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/battle', async (req, res) => {
  try {
    const { playerData, enemy, abilityUsed,
            worldSetting, isEnemyTurn } = req.body;

    console.log(`Battle | ${isEnemyTurn?'Enemy':'Player'} turn | ${enemy?.enemyName} Lv${enemy?.enemyLevel}`);

    const who = isEnemyTurn ? 'Enemy' : 'Player';
    const abilStr = abilityUsed
      ? `${who} uses: ${abilityUsed.name} [${abilityUsed.type||'physical'}] — ${abilityUsed.description} (dmg: ${abilityUsed.damage})`
      : `${who} uses basic attack`;

    const ctx = `World: ${worldSetting}
Player: Lv${playerData.level} | HP:${playerData.hp}/${playerData.maxHp} | STR:${playerData.strength} AGI:${playerData.agility} INT:${playerData.intelligence}
Enemy: ${enemy.enemyName} (${enemy.enemyRace||'unknown'}) Lv${enemy.enemyLevel}
Enemy HP: ${enemy.currentHp}/${enemy.enemyMaxHp}
Enemy stats: STR:${enemy.enemyStr||10} AGI:${enemy.enemyAgi||10} INT:${enemy.enemyInt||10}
Enemy dominant: ${enemy.enemyDominantStat||'strength'}
Is boss: ${enemy.isBoss?'YES':'NO'}
This turn: ${isEnemyTurn
  ? 'ENEMY ATTACKS PLAYER — playerHpChange must be negative (min -5), enemyHpChange=0'
  : 'PLAYER ATTACKS ENEMY — enemyHpChange must be negative (min -5), do not return 0'}
${abilStr}`;

    const raw = await callAI(
      [{ role:'system', content:BATTLE_PROMPT },
       { role:'user', content:ctx }],
      200, 0.8);

    let result;
    try {
      result = JSON.parse(raw.replace(/```json/g,'').replace(/```/g,'').trim());
    } catch(e) {
      result = {
        battleLog: isEnemyTurn
          ? `${enemy.enemyName} strikes hard!`
          : "The blow lands!",
        playerHpChange: isEnemyTurn ? -8 : 0,
        enemyHpChange:  isEnemyTurn ? 0 : -12,
        battleEnded: false,
        playerWon: false,
        xpReward: 0,
        itemDrop: ''
      };
    }

    // Enforce minimum damage
    if (!isEnemyTurn && (result.enemyHpChange||0) === 0) {
      result.enemyHpChange = -5;
      result.battleLog = (result.battleLog||'') + ' The hit connects.';
    }
    if (isEnemyTurn && (result.playerHpChange||0) === 0) {
      result.playerHpChange = -5;
    }

    res.json({ turnResult: result });
  } catch(e) {
    console.error("Battle error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/enemy-abilities', async (req, res) => {
  try {
    const { enemyName, enemyLevel, enemyRace,
            enemyDominantStat, worldSetting } = req.body;

    console.log(`Enemy abilities: ${enemyName} Lv${enemyLevel}`);

    const ctx = `Enemy: ${enemyName} (${enemyRace||'unknown'})
Level: ${enemyLevel||1}
Dominant stat: ${enemyDominantStat||'strength'}
World: ${worldSetting||'unknown world'}`;

    const raw = await callAI(
      [{ role:'system', content:ENEMY_ABILITIES_PROMPT },
       { role:'user', content:ctx }],
      300, 0.8);

    let data;
    try {
      data = JSON.parse(raw.replace(/```json/g,'').replace(/```/g,'').trim());
    } catch(e) {
      data = { abilities: [{
        name: "Basic Attack",
        description: "A direct strike.",
        type: "physical",
        damage: "STR x 1.0",
        cooldown: 0
      }]};
    }

    res.json({ abilities: data.abilities || [] });
  } catch(e) {
    console.error("Enemy abilities:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/world-event', async (req, res) => {
  try {
    const { worldSetting, worldEvents,
            locationStates, playerLevel } = req.body;

    const ctx = `World: ${worldSetting}
Player level: ${playerLevel||1}
Recent events: ${(worldEvents||[]).slice(-5).join(', ')}
Locations: ${JSON.stringify(locationStates||{}).slice(0,300)}`;

    const raw = await callAI(
      [{ role:'system', content:WORLD_EVENT_PROMPT },
       { role:'user', content:ctx }],
      300, 0.9);

    let ev;
    try {
      ev = JSON.parse(raw.replace(/```json/g,'').replace(/```/g,'').trim());
    } catch(e) {
      return res.status(500).json({ error:"Parse failed" });
    }

    if (typeof ev.badEventForPlayer === 'boolean')
      ev.badEventForPlayer = null;

    res.json({ eventData: ev });
  } catch(e) {
    console.error("World event:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/generate-map', async (req, res) => {
  try {
    const { worldSetting, layer, layerName } = req.body;
    console.log("Map - layer:", layer);

    const layerCtx = {
      2:    "High sky. Floating islands, celestial platforms.",
      1:    "Elevated. Mountain peaks, ancient temples.",
      0:    "Ground level. Cities, villages, wilderness, ruins.",
      '-1': "Underground. Caves, buried cities, tunnels.",
      '-2': "Deep dungeon. Ancient vaults, monster lairs.",
      '-3': "The Abyss. Void rifts, demon realms. Highest level only."
    };

    const raw = await callAI(
      [{ role:'system', content:MAP_PROMPT },
       { role:'user', content:
         `Layer ${layer} (${layerName}) for: ${worldSetting}\n`
         + `Context: ${layerCtx[String(layer)]||'appropriate locations'}` }],
      2500, 0.7);

    let mapData;
    try {
      mapData = JSON.parse(raw.replace(/```json/g,'').replace(/```/g,'').trim());
    } catch(e) {
      console.error("Map parse:", e.message);
      return res.status(500).json({ error:"Map parse failed" });
    }

    console.log("Map:", mapData.locations?.length, "locations");
    res.json({ mapData });
  } catch(e) {
    console.error("Map error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/inspect-npc', async (req, res) => {
  try {
    const { npcName, npcData, worldSetting } = req.body;

    const raw = await callAI(
      [{ role:'system', content:INSPECT_PROMPT },
       { role:'user', content:
         `NPC: ${npcName}\nKnown: ${JSON.stringify(npcData||{})}\nWorld: ${worldSetting}` }],
      200, 0.7);

    let data;
    try {
      data = JSON.parse(raw.replace(/```json/g,'').replace(/```/g,'').trim());
    } catch(e) {
      return res.status(500).json({ error:"Parse failed" });
    }

    res.json({ inspectData: data });
  } catch(e) {
    console.error("Inspect:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/ping', (req, res) => {
  res.json({ status:'alive', model:MODEL });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0',
  () => console.log('Proxy running:', MODEL, 'on port', PORT));
