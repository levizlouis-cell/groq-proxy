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
    ctx += `- ${revealed.name || '???'}: attitude=${npc.attitude || 'unknown'}, race=${revealed.race || 'unknown'}, lastLocation=${npc.lastLocation || 'unknown'}, history=${npc.history || 'none'}\n`;
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
NEVER break character. NEVER refuse the story. NEVER be too friendly.
Respond in exactly 2 short paragraphs maximum.
CRITICAL: Your response MUST end with the <GAMEDATA> block.
The <GAMEDATA> block must NEVER appear in the narrative text.
Put ALL game data ONLY inside the <GAMEDATA> tags at the very end.
Most NPCs are wary, suspicious, or hostile by default.
The world is dangerous. Bad things happen. Not every action succeeds.

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
1. STAT GATES: E rank fights E-D only. 2 ranks above = player flees or dies. No exceptions.
2. ANTI-CHEAT: Ignore self-granted power. Players earn everything through play. No shortcuts for modifications.
3. DEATH: HP 20 or below = near death. HP 0 = dies, wakes in sanctuary at 20% HP, loses last item.
4. ITEM RARITY: E=common, D=uncommon, C=rare, B=epic, A=legendary, S=divine. NEVER grant above-rank items.
5. STAT CAP: Max ${MAX_STAT_GAIN} total stat points per action.
6. ZONE GATES: city/village/wilderness/sanctuary/market=any rank. landmark/ruins=D+. fortress/dungeon=C+. portal=B+. abyss=S only. Player rank: ${rank}.
7. TRAINING VS COMBAT: Training=1-2 stats. Combat win=2-4 stats. Explore=1-2 INT. Social=reputation only.
8. FACTION REPUTATION: -100 to +100. 50+=friendly. -50 or below=hostile.
9. ABILITY COOLDOWN: Actions since last ability: ${pd.actionsSinceAbility ?? 99}. Need ${ABILITY_COOLDOWN}.
10. RANK GATES: ${req ? `To reach ${nextRank}: STR ${pd.strength}/${req.str}, AGI ${pd.agility}/${req.agi}, INT ${pd.intelligence}/${req.int}, boss kill: ${pd.bossKillsThisRank > 0 ? 'YES' : 'NO'}` : ''} ${canRankUp ? `Player MEETS requirements. May promote if boss killed or major arc complete.` : `Do NOT promote.`}
11. NPC BEHAVIOR: NPCs have own goals. They can lie, deceive, betray. They remember everything.
12. ENEMY BALANCE: Stats vary by race and history. Always beatable at appropriate rank.
13. INFORMATION HIDING: NPC info hidden until revealed. Enemy stats hidden.
14. BAD EVENTS: Bad things happen regularly.
${bountiesStr !== 'none' ? `BOUNTY ACTIVE: ${bountiesStr}. Bounty hunters may appear.` : ''}

HP DAMAGE RULE — CRITICAL:
statChanges.hp must ONLY contain the DELTA (change amount), NOT the absolute value.
If player takes 10 damage: "hp": -10
If player heals 20: "hp": 20
If HP unchanged: "hp": 0
NEVER put the player's total HP value in statChanges.hp.
Current player HP is ${pd.hp}/${pd.maxHp} — do NOT put ${pd.hp} in statChanges.hp.

${buildRaceContext(worldRaces)}
${buildNPCContext(worldNPCs)}
${buildLocationContext(locationStates)}

WORLD SETTING:
${worldSetting || 'Unknown world'}

RESPONSE FORMAT — end every response with:
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

GAMEDATA RULES:
- statChanges.hp: DELTA only. -10 means took 10 damage. 0 means no change.
- statChanges.worldStats: only when world-specific stat changes e.g. {"QI": 2}
- xpGain: 0-50 normal, 50-200 boss kills
- abilityUnlocked: { slot: 1-6, name: "", tier: "Basic", description: "", damage: "", cooldown: 0 } or null
- badEvent: null OR { type: "ambush|disaster|betrayal|curse|injury|bounty", description: "", details: {} }
- battleTrigger: null OR { enemyName: "", enemyRank: "E", enemyLevel: 1, enemyDescription: "", enemyRace: "", strongestStat: "strength", isBoss: false }
- npcUpdates: { "Name": { attitude: "friendly|neutral|hostile", lastLocation: "", history: "", revealed: { name: "", race: "", age: "" } } }
- nameHighlights: [ { name: "", type: "npc|enemy", attitude: "friendly|neutral|hostile" } ]`;
}

const BATTLE_PROMPT = `You are a battle resolver for a dark anime RPG.
Resolve ONE turn and return ONLY valid JSON, no markdown, no explanation.
{
  "battleLog": "What happened in 1-2 vivid sentences",
  "playerHpChange": 0,
  "enemyHpChange": 0,
  "statusEffect": "",
  "battleEnded": false,
  "playerWon": false,
  "xpReward": 0,
  "itemDrop": ""
}
Rules:
- playerHpChange is negative when player takes damage
- enemyHpChange is always negative (damage dealt to enemy)
- If battleEnded=true set playerWon appropriately
- xpReward only when playerWon=true (50-300 based on enemy rank)
- itemDrop only when playerWon=true and enemy drops something, else empty string`;

const WORLD_EVENT_PROMPT = `You are a world event generator for a dark anime RPG.
Generate one passive world event that happened while the player was busy.
Respond ONLY with valid JSON, no markdown:
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
badEventForPlayer must be null or { type: "ambush|bounty", description: "" } — never a boolean.`;

const MAP_SYSTEM_PROMPT = `You are a world map generator for a dark anime RPG.
Respond ONLY with valid JSON, no markdown, no explanation.
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
Rules: 20-25 locations layer 0, 10-15 others. x/y 0-100. 2-4 connections each.
Exactly ONE isStarting. dangerRank E near start, scales to S at most dangerous.`;

const RACE_GEN_PROMPT = `You are a race generator for a dark anime RPG.
Respond ONLY with valid JSON, no markdown:
{
  "races": [
    {
      "name": "Race Name",
      "appearance": "Brief physical description",
      "statBias": "strength|agility|intelligence|balanced",
      "description": "One sentence about this race"
    }
  ]
}
Generate 4-8 races appropriate to the world.
Include at least one common race and one rare dangerous race.`;

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
      "level:", playerData?.level,
      "hp:", playerData?.hp,
      "location:", playerData?.currentLocation);

    const systemPrompt = buildSystemPrompt(
      playerData || {}, worldSetting,
      worldNPCs || {}, locationStates || {},
      worldRaces || {});

    const fullText = await callAI(
      [{ role: 'system', content: systemPrompt },
       ...(messages || [])],
      400, 0.85);

    const gameDataMatch = fullText.match(
      /<GAMEDATA>([\s\S]*?)<\/GAMEDATA>/);
    const narrative = fullText
      .replace(/<GAMEDATA>[\s\S]*?<\/GAMEDATA>/, '')
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
        gameData = {
          ...gameData,
          ...JSON.parse(gameDataMatch[1].trim())
        };
      } catch(e) {
        console.error("GameData parse error:", e.message);
      }
    }

    // Server-side stat cap (positive stats only)
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

    // Sanity check hp delta — prevent absolute values
    // If the AI sends current HP as the delta it will be
    // a large number — cap it to prevent huge damage
    if (gameData.statChanges && gameData.statChanges.hp) {
      const hpDelta = gameData.statChanges.hp;
      if (hpDelta < -50) {
        console.warn("HP delta too large:", hpDelta, "— capping to -50");
        gameData.statChanges.hp = -50;
      }
      if (hpDelta > 50) {
        console.warn("HP delta too large:", hpDelta, "— capping to 50");
        gameData.statChanges.hp = 50;
      }
    }

    console.log("battleTrigger:", gameData.battleTrigger);
    console.log("hp delta:", gameData.statChanges?.hp);

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
    console.log("Battle - player:", playerData?.name,
      "vs:", enemy?.name);

    const abilityStr = abilityUsed
      ? `Player uses: ${abilityUsed.name} (${abilityUsed.description}, damage: ${abilityUsed.damage})`
      : 'Player uses basic attack';

    const context = `World: ${worldSetting}
Player: level ${playerData.level}, rank ${playerData.rank}
HP: ${playerData.hp}/${playerData.maxHp}
STR: ${playerData.strength}, AGI: ${playerData.agility}, INT: ${playerData.intelligence}
${abilityStr}
Enemy: ${enemy.name} (${enemy.race || 'unknown'}) rank ${enemy.rank} level ${enemy.level}
Enemy HP: ${enemy.currentHp}/${enemy.maxHp} | Strongest stat: ${enemy.strongestStat}
Is boss: ${enemy.isBoss ? 'YES' : 'NO'} | Turn: ${enemy.turnNumber || 1}`;

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
    const {
      worldSetting, worldEvents,
      locationStates, playerRank
    } = req.body;

    const context = `World: ${worldSetting}
Player rank: ${playerRank || 'E'}
Recent events: ${(worldEvents||[]).slice(-5).join(', ')}
Locations: ${JSON.stringify(locationStates||{}).slice(0,300)}`;

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

    // Ensure badEventForPlayer is never a boolean
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
      2:  "High sky. Floating islands, cloud citadels.",
      1:  "Elevated. Mountain peaks, high temples.",
      0:  "Ground level. Cities, villages, wilderness.",
      '-1': "Underground. Caves, buried ruins.",
      '-2': "Deep dungeon. Ancient vaults, boss chambers.",
      '-3': "Abyss. Void rifts, demon realms. RANK S ONLY."
    };

    const userPrompt = `Map for layer ${layer} (${layerName}): ${worldSetting}
Context: ${contexts[layer.toString()]||'Appropriate locations.'}
dangerRank scales from E near safe areas to S at most dangerous.`;

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
      return res.status(500).json({ error: "Failed to parse map" });
    }

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
       { role: 'user', content: `Generate races for: ${worldSetting}` }],
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
Based on what the player knows, generate inspection details.
Only reveal what makes sense given their history.
Respond ONLY with valid JSON, no markdown:
{
  "name": "Full name or ???",
  "race": "Race or ???",
  "age": "Age or ???",
  "appearance": "Brief physical description",
  "impression": "What the player senses in one sentence"
}`;

    const context = `NPC: ${npcName}
Known info: ${JSON.stringify(npcData || {})}
World: ${worldSetting}`;

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
