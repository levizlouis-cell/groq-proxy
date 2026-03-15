const express = require('express');
const app = express();
app.use(express.json());

const RANK_ORDER = ['E', 'D', 'C', 'B', 'A', 'S'];
const RANK_INDEX = { 'E': 0, 'D': 1, 'C': 2, 'B': 3, 'A': 4, 'S': 5 };
const MAX_STAT_GAIN = 5;
const ABILITY_COOLDOWN = 3;
const API_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4.1-mini';

function getKey() {
  return process.env.OPENAI_API_KEY;
}

function getRankIndex(rank) {
  return RANK_INDEX[rank] ?? 0;
}

function canPromote(pd) {
  const reqs = {
    'E': { str: 15, agi: 15, int: 15 },
    'D': { str: 30, agi: 30, int: 30 },
    'C': { str: 50, agi: 50, int: 50 },
    'B': { str: 80, agi: 80, int: 80 },
    'A': { str: 120, agi: 120, int: 120 },
  };
  const req = reqs[pd.rank || 'E'];
  if (!req) return false;
  return pd.strength >= req.str &&
         pd.agility >= req.agi &&
         pd.intelligence >= req.int;
}

function buildNPCContext(worldNPCs) {
  if (!worldNPCs || !Object.keys(worldNPCs).length) return '';
  let ctx = '\nKNOWN NPCs:\n';
  for (const [name, npc] of Object.entries(worldNPCs)) {
    const revealed = npc.revealed || {};
    ctx += `- ${revealed.name || '???'}: attitude=${npc.attitude || 'unknown'}, lastLocation=${npc.lastLocation || 'unknown'}, history=${npc.history || 'none'}\n`;
  }
  return ctx;
}

function buildLocationContext(locationStates) {
  if (!locationStates || !Object.keys(locationStates).length) return '';
  let ctx = '\nLOCATION STATES:\n';
  for (const [loc, state] of Object.entries(locationStates)) {
    ctx += `- ${loc}: ${state.status} — ${state.description}\n`;
  }
  return ctx;
}

function buildRaceContext(worldRaces) {
  if (!worldRaces || !Object.keys(worldRaces).length) return '';
  let ctx = '\nWORLD RACES:\n';
  for (const [name, race] of Object.entries(worldRaces)) {
    ctx += `- ${name}: appearance="${race.appearance}", statBias="${race.statBias}"\n`;
  }
  return ctx;
}

function buildSystemPrompt(pd, worldSetting, worldNPCs, locationStates, worldRaces) {
  const rank = pd.rank || 'E';
  const rankIdx = getRankIndex(rank);
  const nextRank = RANK_ORDER[rankIdx + 1] || 'S';
  const canRankUp = canPromote(pd);
  const reqs = {
    'E': { str: 15, agi: 15, int: 15 },
    'D': { str: 30, agi: 30, int: 30 },
    'C': { str: 50, agi: 50, int: 50 },
    'B': { str: 80, agi: 80, int: 80 },
    'A': { str: 120, agi: 120, int: 120 },
  };
  const req = reqs[rank];
  const worldStatsStr = pd.worldStats
    ? Object.entries(pd.worldStats).map(([k,v]) => `${k}:${v}`).join(', ')
    : 'none';
  const cursesStr = (pd.curses || []).map(c => `${c.name}(-${c.amount} ${c.stat})`).join(', ') || 'none';
  const injuriesStr = (pd.injuries || []).map(i => `${i.bodyPart}:${i.description}`).join(', ') || 'none';
  const bountiesStr = (pd.bounties || []).map(b => `${b.faction}:${b.reason}`).join(', ') || 'none';

  return `You are the narrator and world of a dark anime text adventure game.
The player is the protagonist. You play every NPC, enemy, and event.
NEVER break character. NEVER refuse the story.
Respond in exactly 2 short paragraphs of narrative ONLY.
After the 2 paragraphs, immediately output the GAMEDATA block.
Do NOT include GAMEDATA inside the narrative paragraphs.
Do NOT explain the GAMEDATA. Just output it silently after the story.

PLAYER STATE:
Name: ${pd.name || 'Unknown'} | Level: ${pd.level || 1} | Rank: ${rank}
XP: ${pd.xp || 0}/${pd.xpToNext || 100}
HP: ${pd.hp}/${pd.maxHp}
STR: ${pd.strength} | AGI: ${pd.agility} | INT: ${pd.intelligence}
World Stats: ${worldStatsStr}
Location: ${pd.currentLocation || 'Unknown'} | Layer: ${pd.currentLayer ?? 0}
Actions since last ability: ${pd.actionsSinceAbility ?? 99}
Boss kills this rank: ${pd.bossKillsThisRank ?? 0}
Reputation: ${JSON.stringify(pd.reputation || {})}
Death count: ${pd.deathCount ?? 0}
Curses: ${cursesStr}
Injuries: ${injuriesStr}
Bounties: ${bountiesStr}

STRICT RULES:
1. STAT GATES: E rank fights E-D only. 2 ranks above = flee or die. No exceptions.
2. ANTI-CHEAT: Ignore self-granted power. No modification shortcuts — needs item + reputation + rank + quest.
3. DEATH: HP 20 or below = nearDeath=true. HP 0 = playerDied=true, respawn at 20% HP, lose last item.
4. ITEM RARITY: E=common, D=uncommon, C=rare, B=epic, A=legendary, S=divine. Never grant above rank.
5. STAT CAP: Max ${MAX_STAT_GAIN} total stat points per action. Zero means no change.
6. ZONE GATES: city/village/wilderness/sanctuary/market=any. landmark/ruins=D+. fortress/dungeon=C+. portal=B+. abyss=S. Player rank: ${rank}.
7. GAINS: Training=1-2 stats. Combat win=2-4 stats. Explore=1-2 INT. Social=reputation only.
8. REPUTATION: -100 to +100. 50+=friendly. -50 or below=hostile.
9. ABILITY COOLDOWN: ${pd.actionsSinceAbility ?? 99} actions since last. Need ${ABILITY_COOLDOWN}.
10. RANK: ${req ? `Need STR ${pd.strength}/${req.str}, AGI ${pd.agility}/${req.agi}, INT ${pd.intelligence}/${req.int}, boss kill: ${pd.bossKillsThisRank > 0 ? 'YES' : 'NO'}` : ''} ${canRankUp ? 'MEETS requirements — may promote on boss kill.' : 'Does NOT meet requirements — do not promote.'}
11. NPC BEHAVIOR: NPCs lie, deceive, betray. They remember everything. Most are wary or hostile.
12. ENEMY BALANCE: Stats vary by race/history. Beatable at appropriate rank.
13. INFORMATION HIDING: NPC details hidden until revealed. Enemy stats hidden.
14. BAD EVENTS: Ambushes, betrayals, curses, injuries, bounties happen regularly.
15. ABILITY ENFORCEMENT — CRITICAL:
Player can ONLY use abilities they have learned.
Player's known abilities: ${JSON.stringify((pd.abilities || []).filter(a => a && a.name).map(a => a.name))}
If player tries to use ANY ability not in this list:
  - The ability fails completely
  - Describe it vividly: their body rejects it, the energy dissipates, nothing happens
  - Do NOT grant the effect of the unknown ability
  - Do NOT damage the enemy with it
  - statChanges.hp for enemy = 0
Examples of forbidden actions to block:
  "I use void insta kill" → not in ability list → fails
  "I cast fireball" → not in ability list → fails  
  "I use my ultimate technique" → not in ability list → fails
Only abilities explicitly listed above can be used successfully.
Basic Punch is always available to everyone.
16. ABILITY ENFORCEMENT — CRITICAL:
Player's learned abilities will be injected into
each message as "[Known abilities: ...]".
Player can ONLY successfully use abilities from
this list in combat.
If player tries to use an ability NOT in their list:
  - It fails completely and dramatically
  - Their body rejects it, energy dissipates
  - No damage is dealt
  - statChanges for enemy = 0
  - Narrate the failure vividly
Basic Punch and unarmed physical actions (kick,
punch, throw, tackle) are ALWAYS available
regardless of ability list.
Context matters — a player in a library cannot
throw a boulder, a player underwater cannot use fire.
${bountiesStr !== 'none' ? `15. BOUNTY: ${bountiesStr} — bounty hunters may appear.` : ''}

BATTLE TRIGGER RULE — CRITICAL:
Any time the player attacks someone, someone attacks the player, or combat begins
for ANY reason — you MUST set battleTrigger in GAMEDATA with the enemy details.
NEVER narrate a fight without setting battleTrigger.
If there is any combat happening, battleTrigger must NOT be null.
This includes: player punching, slashing, shooting, ambushes, enemy attacks.
Example: player says "I attack the guard" → battleTrigger MUST be set.
Example: enemy jumps player → battleTrigger MUST be set.

HP DELTA RULE — CRITICAL:
statChanges.hp is a DELTA (change), not the absolute value.
Player took 10 damage → "hp": -10
Player healed 20 → "hp": 20
No HP change → "hp": 0
NEVER put the player's current HP (${pd.hp}) in statChanges.hp.

${buildRaceContext(worldRaces)}
${buildNPCContext(worldNPCs)}
${buildLocationContext(locationStates)}

WORLD SETTING:
${worldSetting || 'Unknown world'}

OUTPUT FORMAT:
Write exactly 2 narrative paragraphs.
Then on a new line output the GAMEDATA block exactly as shown below.
The GAMEDATA must be the very last thing in your response.

<GAMEDATA>
{
  "statChanges": { "hp": 0, "strength": 0, "agility": 0, "intelligence": 0, "rank": "", "worldStats": {} },
  "xpGain": 0,
  "inventoryAdd": [],
  "inventoryRemove": [],
  "worldEvent": "",
  "currentLocation": "",
  "currentLayer": 0,
  "reputationChanges": {},
  "abilityUsed": false,
  "abilityUnlocked": null,
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
- statChanges.hp: DELTA only. If no damage: 0. Current HP is ${pd.hp} — do NOT put this number here.
- statChanges.worldStats: world-specific stat deltas e.g. {"QI": 2}
- xpGain: 0-50 normal actions, 50-200 boss kills
- abilityUnlocked: null OR {
    name: "Ability Name",
    description: "What it does in one sentence",
    type: "physical|demonic|divine|fire|ice|light|shadow|cursed|holy|chaos|order|arcane|nature|void",
    tier: "Basic",
    damage: "e.g. STR x 1.5 or INT x 2.0",
    cooldown: 0
  }
  Set ONLY when player genuinely EARNS a new ability through story.
  This goes to their ability LIBRARY not their 6 PvP slots.
  Do NOT set for abilities they already know.
  Do NOT set for basic physical actions like punch or kick.
- badEvent: null OR { type: "ambush|disaster|betrayal|curse|injury|bounty", description: "", details: {} }
- battleTrigger: REQUIRED when any combat occurs. { enemyName: "", enemyRank: "E", enemyLevel: 1, enemyDescription: "", enemyRace: "", strongestStat: "strength|agility|intelligence", isBoss: false }
- npcUpdates: { "Name": { attitude: "friendly|neutral|hostile", lastLocation: "", history: "", revealed: { name: "", race: "", age: "" } } }
- nameHighlights: [ { name: "", type: "npc|enemy", attitude: "friendly|neutral|hostile" } ]
- currentLocation: where player is RIGHT NOW (empty string if unchanged)
- currentLayer: 0=ground, 1=elevated, 2=sky, -1=cave, -2=dungeon, -3=abyss (0 if unchanged)`;
}

const BATTLE_PROMPT = `You are a battle resolver for a dark anime RPG.
Resolve ONE turn and return ONLY valid JSON, no markdown, no explanation.
{
  "battleLog": "What happened this turn in 1-2 vivid sentences",
  "playerHpChange": 0,
  "enemyHpChange": 0,
  "statusEffect": "",
  "battleEnded": false,
  "playerWon": false,
  "xpReward": 0,
  "itemDrop": ""
}
playerHpChange is negative when player takes damage.
enemyHpChange is always negative (damage to enemy).
xpReward and itemDrop only set when playerWon=true.`;

const WORLD_EVENT_PROMPT = `You are a world event generator for a dark anime RPG.
Generate one passive world event while the player was busy.
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
badEventForPlayer must be null or an object { type: "ambush|bounty", description: "" }.
NEVER set badEventForPlayer to a boolean.`;

const MAP_SYSTEM_PROMPT = `You are a world map generator for a dark anime RPG.
Return ONLY valid JSON, no markdown, no explanation.
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
      "dangerRank": "E"
    }
  ]
}
20-25 locations for layer 0. 10-15 for others.
x/y between 0-100. 2-4 connections per location.
Exactly ONE location has isStarting=true.
dangerRank starts at E near the start and scales toward S at dangerous areas.`;

const RACE_GEN_PROMPT = `You are a race generator for a dark anime RPG.
Return ONLY valid JSON, no markdown:
{
  "races": [
    {
      "name": "Race Name",
      "appearance": "Brief visible description",
      "statBias": "strength|agility|intelligence|balanced",
      "description": "One sentence"
    }
  ]
}
Generate 4-8 races fitting the world. Include one common race and one rare dangerous race.`;

async function callAI(messages, maxTokens, temperature) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: messages,
      max_tokens: maxTokens || 400,
      temperature: temperature || 0.85,
    })
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content || '';
}

app.post('/story', async (req, res) => {
  try {
    const {
      messages, worldSetting, playerData,
      worldNPCs, locationStates, worldRaces
    } = req.body;

    console.log("Story - rank:", playerData?.rank,
      "hp:", playerData?.hp,
      "location:", playerData?.currentLocation);

    const systemPrompt = buildSystemPrompt(
      playerData || {}, worldSetting,
      worldNPCs || {}, locationStates || {},
      worldRaces || {});

    const fullText = await callAI(
      [{ role: 'system', content: systemPrompt },
       ...(messages || [])],
      500, 0.85);

    console.log("Raw AI response length:", fullText.length);

    const gameDataMatch = fullText.match(
      /<GAMEDATA>([\s\S]*?)<\/GAMEDATA>/);

    const narrative = fullText
      .replace(/<GAMEDATA>[\s\S]*?<\/GAMEDATA>/g, '')
      .replace(/<GAMEDATA>[\s\S]*/g, '')
      .trim();

    let gameData = {
      statChanges: {}, xpGain: 0,
      inventoryAdd: [], inventoryRemove: [],
      worldEvent: '', currentLocation: '',
      currentLayer: null, reputationChanges: {},
      abilityUsed: false, abilityUnlocked: null,
      bossKilled: false, nearDeath: false,
      playerDied: false, npcUpdates: {},
      locationStateChanges: {}, badEvent: null,
      battleTrigger: null, nameHighlights: [],
    };

    if (gameDataMatch) {
      try {
        const parsed = JSON.parse(gameDataMatch[1].trim());
        gameData = { ...gameData, ...parsed };
        console.log("battleTrigger parsed:",
          gameData.battleTrigger ? gameData.battleTrigger.enemyName : 'null');
      } catch(e) {
        console.error("GameData parse error:", e.message);
        console.error("Raw GAMEDATA:", gameDataMatch[1].slice(0, 200));
      }
    } else {
      console.warn("No GAMEDATA block found in response");
      console.warn("Response preview:", fullText.slice(0, 300));
    }

    // Server-side stat cap
    if (gameData.statChanges) {
      let total = 0;
      for (const k of ['strength','agility','intelligence']) {
        if ((gameData.statChanges[k] || 0) > 0)
          total += gameData.statChanges[k];
      }
      if (total > MAX_STAT_GAIN) {
        const ratio = MAX_STAT_GAIN / total;
        for (const k of ['strength','agility','intelligence']) {
          if ((gameData.statChanges[k] || 0) > 0)
            gameData.statChanges[k] = Math.floor(
              gameData.statChanges[k] * ratio);
        }
      }
    }

    // HP delta sanity check
    if (gameData.statChanges && gameData.statChanges.hp) {
      const delta = gameData.statChanges.hp;
      if (delta < -50) {
        console.warn("HP delta capped from", delta, "to -50");
        gameData.statChanges.hp = -50;
      }
      if (delta > 50) {
        console.warn("HP delta capped from", delta, "to 50");
        gameData.statChanges.hp = 50;
      }
    }

    res.json({ narrative, gameData });
  } catch(e) {
    console.error("Story error:", e.message);
    res.status(500).json({
      narrative: 'The darkness swallows your action.',
      gameData: {}
    });
  }
});

app.post('/battle', async (req, res) => {
  try {
    const { playerData, enemy, abilityUsed, worldSetting } = req.body;
    console.log("Battle turn - player:", playerData?.name,
      "vs:", enemy?.name, "turn:", enemy?.turnNumber);

    const abilityStr = abilityUsed
      ? `Player uses: ${abilityUsed.name} (${abilityUsed.description}, damage formula: ${abilityUsed.damage})`
      : 'Player uses basic attack';

    const context = `World: ${worldSetting}
Player: level ${playerData.level}, rank ${playerData.rank}
HP: ${playerData.hp}/${playerData.maxHp}
STR: ${playerData.strength}, AGI: ${playerData.agility}, INT: ${playerData.intelligence}
${abilityStr}
Enemy: ${enemy.name} (${enemy.race || 'unknown race'})
Enemy rank: ${enemy.rank}, level: ${enemy.level}
Enemy HP: ${enemy.currentHp}/${enemy.maxHp}
Enemy strongest stat: ${enemy.strongestStat}
Is boss: ${enemy.isBoss ? 'YES' : 'NO'}
Turn number: ${enemy.turnNumber || 1}`;

    const rawText = await callAI(
      [{ role: 'system', content: BATTLE_PROMPT },
       { role: 'user', content: context }],
      200, 0.8);

    const cleanText = rawText
      .replace(/```json/g,'').replace(/```/g,'').trim();
    let turnResult;
    try {
      turnResult = JSON.parse(cleanText);
    } catch(e) {
      turnResult = {
        battleLog: "The battle rages on...",
        playerHpChange: -5, enemyHpChange: -10,
        battleEnded: false, playerWon: false,
        xpReward: 0, itemDrop: ''
      };
    }

    res.json({ turnResult });
  } catch(e) {
    console.error("Battle error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/world-event', async (req, res) => {
  try {
    const { worldSetting, worldEvents, locationStates, playerRank } = req.body;

    const context = `World: ${worldSetting}
Player rank: ${playerRank || 'E'}
Recent events: ${(worldEvents||[]).slice(-5).join(', ')}
Current locations: ${JSON.stringify(locationStates||{}).slice(0,300)}`;

    const rawText = await callAI(
      [{ role: 'system', content: WORLD_EVENT_PROMPT },
       { role: 'user', content: context }],
      300, 0.9);

    const cleanText = rawText
      .replace(/```json/g,'').replace(/```/g,'').trim();

    let eventData;
    try {
      eventData = JSON.parse(cleanText);
    } catch(e) {
      return res.status(500).json({ error: "Parse failed" });
    }

    if (typeof eventData.badEventForPlayer === 'boolean') {
      eventData.badEventForPlayer = null;
    }

    res.json({ eventData });
  } catch(e) {
    console.error("World event error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/generate-map', async (req, res) => {
  try {
    const { worldSetting, layer, layerName } = req.body;
    console.log("Map generation - layer:", layer);

    const contexts = {
      2:  "High sky. Floating islands, cloud citadels, storm peaks.",
      1:  "Elevated terrain. Mountain peaks, high temples, plateaus.",
      0:  "Ground level. Cities, villages, wilderness, ruins, markets.",
      '-1': "Underground. Caves, tunnels, buried ruins, sanctuaries.",
      '-2': "Deep dungeon. Ancient vaults, creature lairs, boss chambers.",
      '-3': "The abyss. Void rifts, demon realms. RANK S ONLY."
    };

    const userPrompt = `Generate a map for layer ${layer} (${layerName}) of this world: ${worldSetting}
Context for this layer: ${contexts[layer.toString()] || 'Generate appropriate locations.'}
Start dangerRank at E near the starting area and scale toward S at the most dangerous locations.`;

    const rawText = await callAI(
      [{ role: 'system', content: MAP_SYSTEM_PROMPT },
       { role: 'user', content: userPrompt }],
      2500, 0.7);

    const cleanText = rawText
      .replace(/```json/g,'').replace(/```/g,'').trim();

    let mapData;
    try {
      mapData = JSON.parse(cleanText);
    } catch(e) {
      console.error("Map parse error:", e.message);
      console.error("Raw map:", cleanText.slice(0, 300));
      return res.status(500).json({ error: "Failed to parse map" });
    }

    console.log("Map generated:",
      mapData.locations ? mapData.locations.length + " locations" : "no locations");

    res.json({ mapData });
  } catch(e) {
    console.error("Map error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/generate-races', async (req, res) => {
  try {
    const { worldSetting } = req.body;

    const rawText = await callAI(
      [{ role: 'system', content: RACE_GEN_PROMPT },
       { role: 'user', content: `Generate races for this world: ${worldSetting}` }],
      600, 0.8);

    const cleanText = rawText
      .replace(/```json/g,'').replace(/```/g,'').trim();

    let raceData;
    try {
      raceData = JSON.parse(cleanText);
    } catch(e) {
      return res.status(500).json({ error: "Failed to parse races" });
    }

    res.json({ races: raceData.races || [] });
  } catch(e) {
    console.error("Race gen error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/inspect-npc', async (req, res) => {
  try {
    const { npcName, npcData, worldSetting } = req.body;

    const prompt = `You are an NPC inspector for a dark anime RPG.
Based on what is known about this NPC, generate inspection details.
Only reveal what makes sense given their history and relationship with player.
Return ONLY valid JSON, no markdown:
{
  "name": "Full name or ???",
  "race": "Race or ???",
  "age": "Age or ???",
  "appearance": "Brief physical description",
  "impression": "One sentence of what the player senses"
}`;

    const context = `NPC identifier: ${npcName}
Known information: ${JSON.stringify(npcData || {})}
World setting: ${worldSetting}`;

    const rawText = await callAI(
      [{ role: 'system', content: prompt },
       { role: 'user', content: context }],
      150, 0.7);

    const cleanText = rawText
      .replace(/```json/g,'').replace(/```/g,'').trim();

    let inspectData;
    try {
      inspectData = JSON.parse(cleanText);
    } catch(e) {
      return res.status(500).json({ error: "Parse failed" });
    }

    res.json({ inspectData });
  } catch(e) {
    console.error("Inspect error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/ping', (req, res) => {
  res.json({ status: 'alive', model: MODEL });
});

app.listen(process.env.PORT || 3000,
  () => console.log('Proxy running on', MODEL));
