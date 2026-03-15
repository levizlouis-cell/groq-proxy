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
      max_tokens: maxTokens || 500,
      temperature: temp || 0.85,
    })
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  return d.choices?.[0]?.message?.content || '';
}

function buildNPCContext(npcs) {
  if (!npcs || !Object.keys(npcs).length) return '';
  let s = '\nKNOWN NPCs (remember everything):\n';
  for (const [name, n] of Object.entries(npcs)) {
    s += `- ${name}: attitude=${n.attitude||'unknown'}, level=${n.level||'?'}, race=${n.race||'?'}, age=${n.age||'?'}\n`;
    if (n.history)      s += `  history: ${n.history}\n`;
    if (n.itemsTraded)  s += `  items traded: ${n.itemsTraded}\n`;
    if (n.promises)     s += `  promises: ${n.promises}\n`;
    if (n.betrayals)    s += `  betrayals: ${n.betrayals}\n`;
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
  return lib ? `\nKnown abilities: ${lib}` : '\nKnown abilities: none';
}

function buildInventoryContext(pd) {
  const inv = (pd.inventory || [])
    .map(i => typeof i === 'string' ? i : i.name)
    .filter(Boolean);
  return inv.length
    ? `\nInventory: ${inv.join(', ')}`
    : '\nInventory: empty';
}

function buildSystemPrompt(pd, worldSetting, worldNPCs, locationStates, worldRaces) {
  const level = pd.level || 1;
  const worldStatsStr = pd.worldStats
    ? Object.entries(pd.worldStats).map(([k,v])=>`${k}:${v}`).join(', ')
    : 'none';
  const cursesStr   = (pd.curses||[]).map(c=>c.name).join(', ')||'none';
  const injStr      = (pd.injuries||[]).map(i=>i.bodyPart).join(', ')||'none';
  const bountiesStr = (pd.bounties||[]).map(b=>b.faction).join(', ')||'none';
  const traitStr    = (pd.traits||[]).map(t=>t.name||t).join(', ')||'none';

  return `You are the narrator and living world of a dark anime text adventure RPG.
The player is the protagonist. You play every NPC, enemy, faction, and event.
NEVER break character. NEVER refuse the story.
Write exactly 2 short narrative paragraphs. Then output the GAMEDATA block.
The world is dangerous, morally complex, and consequence-driven.
Most NPCs are wary or self-interested by default.

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
High level enemies cannot be instantly killed by low level players.

RULE 2 — ABILITY ENFORCEMENT:
Player can ONLY use abilities in "Known abilities" list above.
Unknown ability attempt = fails dramatically, no damage, narrate vividly.
Basic unarmed actions (punch, kick, throw, tackle) always available.
Context matters — no fire underwater, no boulder throw in corridors.

RULE 3 — ITEM ENFORCEMENT:
Player can ONLY use items in "Inventory" above.
Item not in inventory = it simply isn't there.
Items are story/crafting materials — not battle consumables.
Exception: throwing an item consumes it and does minimal damage.

RULE 4 — ABILITY EARNING:
Only grant abilities when player:
  - Trained explicitly over multiple actions
  - Defeated a specific enemy that teaches it
  - Found a scroll/tome/teacher
  - A major story event justified it
NOT for: asking for it, single meditation, casual purchase.
Tier limits: Level 1-5=Basic, Level 6-15=Advanced, Level 16+=Mastered, Level 30+=Legendary.

RULE 5 — BODY MODIFICATION:
Requires: specific item in inventory + appropriate level + willing NPC + narrative time.
If requirements not met: NPC refuses or procedure fails.

RULE 6 — NO INSTANT KILLS:
Enemies with HP > 1 cannot be instantly killed.
Powerful enemies require multiple turns.
Boss enemies require full battle.

RULE 7 — NO TELEPORTATION:
Travel takes narrative time proportional to distance.
Fast travel only if world has established teleportation systems.

RULE 8 — NPC MEMORY:
NPCs remember EVERYTHING from their history.
Betrayed NPC = always hostile. Helped NPC = always remembers.
Never reset attitudes without genuine story reason.
NPCs have own goals and will lie, deceive, manipulate.

RULE 9 — WORLD CONSISTENCY:
Destroyed buildings stay destroyed. Dead characters stay dead.
Consequences ripple through the world permanently.

RULE 10 — ITEM THEME:
Items must fit the world setting. No anachronistic items.

RULE 11 — STAT CAP:
Max ${MAX_STAT_GAIN} total stat points per action.
Max HP delta: ±${MAX_HP_DELTA}. Max XP: ${MAX_XP_GAIN}.

RULE 12 — BATTLE TRIGGER:
ANY combat start = battleTrigger MUST be set with full enemy data including stats and HP.
NEVER narrate a fight without battleTrigger.

RULE 13 — NPC HIGHLIGHTS:
Every named NPC or enemy mentioned = must appear in nameHighlights.
friendly=green, hostile=red, unknown=white.

════════════════════════════════════════
RESPONSE FORMAT
════════════════════════════════════════
Write 2 narrative paragraphs ONLY.
Then output this block exactly:

<GAMEDATA>
{
  "statChanges": { "hp": 0, "strength": 0, "agility": 0, "intelligence": 0, "worldStats": {} },
  "xpGain": 0,
  "inventoryAdd": [],
  "inventoryRemove": [],
  "worldEvent": "",
  "currentLocation": "",
  "currentLayer": 0,
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
- statChanges.hp: DELTA only. -10=took 10 damage. 0=no change. NEVER put current HP (${pd.hp}) here.
- statChanges.worldStats: world-specific deltas e.g. {"QI": 2}
- xpGain: 0-50 normal, 50-200 boss. Cap ${MAX_XP_GAIN}.
- inventoryAdd: plain strings only e.g. ["Iron Sword", "Herb"]
- inventoryRemove: strings of items actually consumed
- abilityUnlocked: null OR { name:"", description:"", type:"physical|demonic|divine|fire|ice|light|shadow|cursed|holy|chaos|order|arcane|nature|void", tier:"Basic", damage:"STR x 1.0", cooldown:0 }
- traitGained: null OR { name:"", description:"", source:"" }
- battleTrigger: null OR { enemyName:"", enemyLevel:1, enemyHp:100, enemyMaxHp:100, enemyStr:10, enemyAgi:10, enemyInt:10, enemyDominantStat:"strength", enemyDescription:"", enemyRace:"", isBoss:false }
  enemyHp = 50 + (enemyLevel * 20). Stats vary by type.
- npcUpdates: { "Name": { attitude:"friendly|hostile|unknown", level:1, race:"", age:"", history:"", itemsTraded:"", promises:"", betrayals:"" } }
- nameHighlights: [ { name:"", type:"npc|enemy", attitude:"friendly|hostile|unknown", level:1 } ]
- badEvent: null OR { type:"ambush|disaster|betrayal|curse|injury|bounty", description:"", details:{} }
- currentLocation: where player is NOW (empty if unchanged)
- currentLayer: 0=ground,1=elevated,2=sky,-1=cave,-2=dungeon,-3=abyss (0 if unchanged)`;
}

const WORLD_CREATION_PROMPT = `You are a world builder for a dark anime text adventure RPG.
Given a player's world description, generate their starting world data.
Return ONLY valid JSON, no markdown:
{
  "races": [
    {
      "name": "Race Name",
      "appearance": "Brief visible description",
      "statBias": "strength|agility|intelligence|balanced",
      "statBonus": { "strength": 0, "agility": 0, "intelligence": 0 },
      "trait": "Trait name",
      "traitDescription": "What the trait does"
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
- Generate 4-8 races fitting the world
- Player race randomly chosen from races
- Starting ability random, fits world theme
- statBonus total 2-4 points max
- Trait must be interesting and narratively meaningful`;

const BATTLE_PROMPT = `You are a battle resolver for a dark anime RPG.
Resolve ONE turn and return ONLY valid JSON, no markdown:
{
  "battleLog": "1-2 vivid sentences of what happened this turn",
  "playerHpChange": 0,
  "enemyHpChange": 0,
  "battleEnded": false,
  "playerWon": false,
  "xpReward": 0,
  "itemDrop": ""
}
Rules:
- playerHpChange negative = player took damage
- enemyHpChange always negative = damage to enemy
- If isEnemyTurn=true in context: enemy attacks, playerHpChange is negative, enemyHpChange=0
- Scale damage with relevant stats vs target defense stats
- xpReward and itemDrop only when playerWon=true
- xpReward: 20 + (enemyLevel * 10), more for bosses`;

const ENEMY_ABILITIES_PROMPT = `You are an ability generator for enemies in a dark anime RPG.
Given an enemy, generate 2-3 abilities they would realistically have.
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
- Abilities must fit the enemy type, race, and world
- Scale power to enemy level
- Include at least one basic attack with cooldown 0
- Higher level enemies get more powerful abilities
- Cooldowns 0-3 turns`;

const WORLD_EVENT_PROMPT = `You are a world event generator for a dark anime RPG.
Generate one passive world event while player was busy.
Return ONLY valid JSON, no markdown:
{
  "eventTitle": "Short title",
  "eventDescription": "2-3 sentences",
  "affectedLocation": "Location name",
  "locationStatus": "attacked|ruined|thriving|locked|changed|reinforced|abandoned",
  "locationDescription": "New one sentence state",
  "affectedFaction": "",
  "factionChange": 0,
  "severity": "minor|moderate|major",
  "badEventForPlayer": null
}
badEventForPlayer: null or { type:"ambush|bounty", description:"" } — never a boolean.`;

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
      "description": "One sentence",
      "connections": ["loc_2"],
      "isStarting": false,
      "minLevel": 1
    }
  ]
}
Rules:
- 20-25 locations layer 0, 10-15 others
- x/y 0-100, 2-4 connections each
- Exactly ONE isStarting=true
- minLevel: start=1, mid=5-10, dangerous=15-25`;

const INSPECT_PROMPT = `You are an NPC inspector for a dark anime RPG.
Reveal only what makes sense given their history.
Return ONLY valid JSON, no markdown:
{
  "name": "Full name or ???",
  "race": "Race or ???",
  "age": "Age or ???",
  "level": 1,
  "appearance": "Brief physical description",
  "impression": "One sentence of what player senses",
  "attitude": "friendly|hostile|unknown"
}`;

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
      max_tokens: maxTokens || 500,
      temperature: temp || 0.85,
    })
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  return d.choices?.[0]?.message?.content || '';
}

app.post('/story', async (req, res) => {
  try {
    const { messages, worldSetting, playerData,
            worldNPCs, locationStates, worldRaces } = req.body;

    console.log(`Story | Lv${playerData?.level} | HP:${playerData?.hp} | ${playerData?.currentLocation}`);

    const prompt = buildSystemPrompt(
      playerData || {}, worldSetting,
      worldNPCs || {}, locationStates || {},
      worldRaces || {});

    const raw = await callAI(
      [{ role:'system', content:prompt },
       ...(messages||[])],
      500, 0.85);

    const match = raw.match(/<GAMEDATA>([\s\S]*?)<\/GAMEDATA>/);
    const narrative = raw
      .replace(/<GAMEDATA>[\s\S]*?<\/GAMEDATA>/g, '')
      .replace(/<GAMEDATA>[\s\S]*/g, '')
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
        gd = { ...gd, ...JSON.parse(match[1].trim()) };
      } catch(e) {
        console.error("GAMEDATA parse error:", e.message);
      }
    } else {
      console.warn("No GAMEDATA found in response");
    }

    // Server-side enforcement
    if (gd.statChanges) {
      let total = 0;
      for (const k of ['strength','agility','intelligence']) {
        if ((gd.statChanges[k]||0) > 0) total += gd.statChanges[k];
      }
      if (total > MAX_STAT_GAIN) {
        const r = MAX_STAT_GAIN / total;
        for (const k of ['strength','agility','intelligence']) {
          if ((gd.statChanges[k]||0) > 0)
            gd.statChanges[k] = Math.floor(gd.statChanges[k] * r);
        }
      }
      if (gd.statChanges.hp) {
        gd.statChanges.hp = Math.max(-MAX_HP_DELTA,
          Math.min(MAX_HP_DELTA, gd.statChanges.hp));
      }
    }

    if (gd.xpGain > MAX_XP_GAIN) gd.xpGain = MAX_XP_GAIN;

    if (gd.abilityUnlocked && gd.abilityUnlocked.name) {
      const lvl = playerData?.level || 1;
      const tierMin = { Basic:1, Advanced:6, Mastered:16 };
      const tier = gd.abilityUnlocked.tier || 'Basic';
      if (lvl < (tierMin[tier] || 1)) {
        gd.abilityUnlocked.tier = 'Basic';
      }
    }

    if (gd.battleTrigger && !gd.battleTrigger.enemyName) {
      gd.battleTrigger = null;
    }

    if (typeof gd.badEvent === 'boolean') gd.badEvent = null;

    console.log("battleTrigger:", gd.battleTrigger?.enemyName || 'none');

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
      console.error("World creation parse error:", e.message);
      return res.status(500).json({ error:"Parse failed" });
    }

    res.json({ worldData: data });
  } catch(e) {
    console.error("World creation error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/battle', async (req, res) => {
  try {
    const { playerData, enemy, abilityUsed,
            worldSetting, isEnemyTurn } = req.body;

    console.log(`Battle | ${isEnemyTurn?'Enemy':'Player'} turn | ${enemy?.enemyName} Lv${enemy?.enemyLevel}`);

    const abilStr = abilityUsed
      ? `${isEnemyTurn ? 'Enemy' : 'Player'} uses: ${abilityUsed.name} [${abilityUsed.type||'physical'}] — ${abilityUsed.description} (dmg formula: ${abilityUsed.damage})`
      : `${isEnemyTurn ? 'Enemy' : 'Player'} uses basic attack`;

    const ctx = `World: ${worldSetting}
Player: Lv${playerData.level} | HP:${playerData.hp}/${playerData.maxHp} | STR:${playerData.strength} AGI:${playerData.agility} INT:${playerData.intelligence}
Enemy: ${enemy.enemyName} (${enemy.enemyRace||'unknown'}) Lv${enemy.enemyLevel}
Enemy HP: ${enemy.currentHp}/${enemy.enemyMaxHp}
Enemy stats: STR:${enemy.enemyStr||10} AGI:${enemy.enemyAgi||10} INT:${enemy.enemyInt||10}
Enemy dominant: ${enemy.enemyDominantStat||'strength'}
Is boss: ${enemy.isBoss?'YES':'NO'}
This turn: ${isEnemyTurn ? 'ENEMY ATTACKS PLAYER' : 'PLAYER ATTACKS ENEMY'}
${abilStr}`;

    const raw = await callAI(
      [{ role:'system', content:BATTLE_PROMPT },
       { role:'user', content:ctx }],
      200, 0.8);

    let result;
    try {
      result = JSON.parse(
        raw.replace(/```json/g,'').replace(/```/g,'').trim());
    } catch(e) {
      result = {
        battleLog: isEnemyTurn
          ? `${enemy.enemyName} strikes!`
          : "The battle continues...",
        playerHpChange: isEnemyTurn ? -8 : 0,
        enemyHpChange: isEnemyTurn ? 0 : -10,
        battleEnded: false,
        playerWon: false,
        xpReward: 0,
        itemDrop: ''
      };
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

    console.log(`Enemy abilities for: ${enemyName} Lv${enemyLevel}`);

    const ctx = `Enemy: ${enemyName} (${enemyRace||'unknown race'})
Level: ${enemyLevel||1}
Dominant stat: ${enemyDominantStat||'strength'}
World: ${worldSetting}`;

    const raw = await callAI(
      [{ role:'system', content:ENEMY_ABILITIES_PROMPT },
       { role:'user', content:ctx }],
      300, 0.8);

    let data;
    try {
      data = JSON.parse(
        raw.replace(/```json/g,'').replace(/```/g,'').trim());
    } catch(e) {
      console.error("Enemy abilities parse error:", e.message);
      data = {
        abilities: [{
          name: "Basic Attack",
          description: "A direct strike.",
          type: "physical",
          damage: "STR x 1.0",
          cooldown: 0
        }]
      };
    }

    res.json({ abilities: data.abilities || [] });
  } catch(e) {
    console.error("Enemy abilities error:", e.message);
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
      ev = JSON.parse(
        raw.replace(/```json/g,'').replace(/```/g,'').trim());
    } catch(e) {
      return res.status(500).json({ error:"Parse failed" });
    }

    if (typeof ev.badEventForPlayer === 'boolean')
      ev.badEventForPlayer = null;

    res.json({ eventData: ev });
  } catch(e) {
    console.error("World event error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/generate-map', async (req, res) => {
  try {
    const { worldSetting, layer, layerName } = req.body;
    console.log("Map - layer:", layer);

    const ctx = {
      2:   "High sky. Floating islands, celestial realms.",
      1:   "Elevated. Mountain peaks, high temples.",
      0:   "Ground level. Cities, villages, wilderness.",
      '-1':"Underground. Caves, buried ruins.",
      '-2':"Deep dungeon. Ancient vaults, boss chambers.",
      '-3':"Abyss. Void rifts, demon realms. High level only."
    };

    const raw = await callAI(
      [{ role:'system', content:MAP_PROMPT },
       { role:'user', content:
         `Layer ${layer} (${layerName}) for: ${worldSetting}\n`
         + `Context: ${ctx[String(layer)]||'appropriate'}` }],
      2500, 0.7);

    let mapData;
    try {
      mapData = JSON.parse(
        raw.replace(/```json/g,'').replace(/```/g,'').trim());
    } catch(e) {
      console.error("Map parse error:", e.message);
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
      150, 0.7);

    let data;
    try {
      data = JSON.parse(
        raw.replace(/```json/g,'').replace(/```/g,'').trim());
    } catch(e) {
      return res.status(500).json({ error:"Parse failed" });
    }

    res.json({ inspectData: data });
  } catch(e) {
    console.error("Inspect error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/ping', (req, res) => {
  res.json({ status:'alive', model:MODEL });
});

app.listen(process.env.PORT || 3000,
  () => console.log('Proxy running:', MODEL));
