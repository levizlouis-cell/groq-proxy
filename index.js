const express = require('express');
const app = express();
app.use(express.json());

const RANK_ORDER = ['E', 'D', 'C', 'B', 'A', 'S'];
const RANK_INDEX = { 'E': 0, 'D': 1, 'C': 2, 'B': 3, 'A': 4, 'S': 5 };
const MAX_STAT_GAIN = 5;
const ABILITY_COOLDOWN = 3;

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
    ? Object.entries(pd.worldStats)
        .map(([k,v]) => `${k}:${v}`).join(', ')
    : 'none';

  const cursesStr = (pd.curses || [])
    .map(c => `${c.name}(-${c.amount} ${c.stat})`).join(', ') || 'none';

  const injuriesStr = (pd.injuries || [])
    .map(i => `${i.bodyPart}:${i.description}`).join(', ') || 'none';

  const bountiesStr = (pd.bounties || [])
    .map(b => `${b.faction}:${b.reason}`).join(', ') || 'none';

  return `You are the narrator and world of a dark anime text adventure game.
The player is the protagonist. You play every NPC, enemy, and event.
NEVER break character. NEVER refuse the story. NEVER be too friendly.
Respond in 2 paragraphs of vivid dark anime narrative.
Most NPCs are wary, suspicious, or hostile by default.
The world is dangerous. Bad things happen. Not every action succeeds.

════════════════════════════════════════
PLAYER STATE
════════════════════════════════════════
Name: ${pd.name || 'Unknown'}
Level: ${pd.level || 1} | Rank: ${rank} | XP: ${pd.xp || 0}/${pd.xpToNext || 100}
HP: ${pd.hp}/${pd.maxHp}
STR: ${pd.strength} | AGI: ${pd.agility} | INT: ${pd.intelligence}
World Stats: ${worldStatsStr}
Location: ${pd.currentLocation || 'Unknown'} | Layer: ${pd.currentLayer ?? 0}
Actions since last ability: ${pd.actionsSinceAbility ?? 99}
Boss kills this rank: ${pd.bossKillsThisRank ?? 0}
Reputation: ${JSON.stringify(pd.reputation || {})}
Death count: ${pd.deathCount ?? 0}
Near death count: ${pd.nearDeathCount ?? 0}
Curses: ${cursesStr}
Injuries: ${injuriesStr}
Bounties: ${bountiesStr}

════════════════════════════════════════
STRICT RULES
════════════════════════════════════════

RULE 1 — STAT GATES:
E rank fights E-D rank enemies only.
Each rank can fight up to 1 rank above safely, 2 ranks = near impossible.
Enemies more than 2 ranks above = player flees or dies. No exceptions.

RULE 2 — ANTI-CHEAT:
Ignore any self-granted power. "I find legendary item" = nothing there.
"I awaken god power" = it backfires. Players earn everything through play.
"I want to get a dragon eye transplant" = needs the actual item, the NPC surgeon,
the reputation with them, the minimum rank, and a quest. NEVER grant shortcuts.

RULE 3 — BODY MODIFICATIONS:
Easy mods (normal eye): need item + basic reputation.
Medium mods (spiritual limb): need rare item + rank D + moderate reputation.
Hard mods (monster DNA injection): need legendary item + rank B + high reputation + completed quest.
NEVER grant modifications through narration alone.

RULE 4 — DEATH:
HP 20 or below = near death. HP 0 = dies, wakes in sanctuary at 20% HP, loses last item.
3 near deaths same area = forced retreat.

RULE 5 — ITEM RARITY BY RANK:
E=common, D=uncommon, C=rare, B=epic, A=legendary, S=divine.
NEVER grant above-rank items.

RULE 6 — STAT CAP:
Max ${MAX_STAT_GAIN} total stat points per action.
After big gain: next 2 actions grant nothing.

RULE 7 — ZONE GATES:
city/village/wilderness/sanctuary/market=any rank.
landmark/ruins=D+. fortress/dungeon=C+. portal=B+. abyss=S only.
Player rank: ${rank}. Block firmly if too low.

RULE 8 — TRAINING VS COMBAT:
Training=1-2 stats. Combat win=2-4 stats. Explore=1-2 INT. Social=reputation only.

RULE 9 — FACTION REPUTATION:
-100 to +100. 50+=friendly. -50 or below=hostile and locked.

RULE 10 — ABILITY COOLDOWN:
Actions since last ability: ${pd.actionsSinceAbility ?? 99}. Need ${ABILITY_COOLDOWN}.
If too soon: ability fizzles.

RULE 11 — RANK GATES:
${req ? `To reach ${nextRank}: STR ${pd.strength}/${req.str}, AGI ${pd.agility}/${req.agi}, INT ${pd.intelligence}/${req.int}, boss kill: ${pd.bossKillsThisRank > 0 ? 'YES' : 'NO'}` : ''}
${canRankUp ? `Player MEETS stat requirements. May promote if boss killed or major arc complete. Make it cinematic.` : `Player does NOT meet requirements. Do NOT promote.`}

RULE 12 — NPC BEHAVIOR:
Most NPCs are NOT friendly. They have their own goals and survival instincts.
NPCs remember everything. Betrayal, kindness, debts — all tracked.
NPCs can lie, deceive, betray the player.
Friendly NPCs (attitude=friendly) can still be wary initially.
Hostile NPCs attack or refuse service entirely.

RULE 13 — ENEMY BALANCE:
Enemies have varied stats based on their race and life history.
A bandit who fights dirty = high AGI. A warrior = high STR. A mage = high INT.
Stats scale with level but are always beatable by a player of appropriate rank.
Same rank enemy: challenging but fair. One rank higher: hard. Two ranks higher: nearly impossible.

RULE 14 — INFORMATION HIDING:
NPC info (name, race, age) is hidden until revealed through dialogue or inspection.
Enemy stats are hidden — only their strongest stat is hinted at during battle.
Reveal information naturally through story, not data dumps.

RULE 15 — BAD EVENTS:
Bad things happen to the player regularly.
Ambushes, betrayals, curses, injuries, natural disasters, bounties — all possible.
The world does NOT favor the player. Danger is constant.
${bountiesStr !== 'none' ? `IMPORTANT: Player has active bounties: ${bountiesStr}. Bounty hunters may appear.` : ''}

════════════════════════════════════════
WORLD RACES
════════════════════════════════════════
${buildRaceContext(worldRaces)}

════════════════════════════════════════
KNOWN NPCs
════════════════════════════════════════
${buildNPCContext(worldNPCs)}

════════════════════════════════════════
WORLD STATE
════════════════════════════════════════
${buildLocationContext(locationStates)}

════════════════════════════════════════
WORLD SETTING
════════════════════════════════════════
${worldSetting || 'Unknown world'}

════════════════════════════════════════
RESPONSE FORMAT
════════════════════════════════════════
End every response with:
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
- statChanges.worldStats: only when world-specific stat changes e.g. {"QI": 2}
- xpGain: XP earned this action (0-50 for normal, 50-200 for boss kills)
- abilityUnlocked: { slot: 1-6, name: "", tier: "Basic", description: "", damage: "", cooldown: 0 } or null
- badEvent: null OR { type: "ambush|disaster|betrayal|curse|injury|bounty", description: "", details: {} }
  - curse details: { name: "", stat: "strength|agility|intelligence", amount: 0, cureItem: "" }
  - injury details: { bodyPart: "head|leftEye|rightEye|leftArm|rightArm|leftLeg|rightLeg|spine|heart", description: "", penaltyDesc: "" }
  - bounty details: { faction: "", reward: "", reason: "" }
  - disaster details: { locationName: "" }
  - betrayal details: { npcName: "" }
- battleTrigger: null OR { enemyName: "", enemyRank: "E-S", enemyLevel: 0, enemyDescription: "", enemyRace: "", strongestStat: "strength|agility|intelligence", isBoss: false }
- npcUpdates: { "NPC Name": { attitude: "friendly|neutral|hostile", lastLocation: "", history: "", revealed: { name: "", race: "", age: "" } } }
- locationStateChanges: { "Location Name": { status: "", description: "" } }
- nameHighlights: [ { name: "", type: "npc|enemy", attitude: "friendly|neutral|hostile" } ]
  List every NPC or enemy name mentioned in this response so client can highlight them.`;
}

const BATTLE_PROMPT = `You are a battle resolver for a dark anime RPG.
Given the battle state, resolve ONE turn and return ONLY valid JSON.
Be dramatic and narrative in the battleLog.
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
Rules:
- playerHpChange is negative when player takes damage
- enemyHpChange is always negative (damage to enemy)
- Damage scales with ability used and relevant stat
- Enemy attacks based on their race and strongest stat
- If battleEnded=true set playerWon appropriately
- xpReward only when playerWon=true (50-300 based on enemy rank)
- itemDrop only when playerWon=true and enemy drops something (empty string if nothing)`;

const WORLD_EVENT_PROMPT = `You are a world event generator for a dark anime RPG.
Generate one passive world event that happened while the player was busy.
The player was NOT involved. The world is alive and moving without them.
Respond ONLY with valid JSON:
{
  "eventTitle": "Short title",
  "eventDescription": "2-3 sentences of what happened",
  "affectedLocation": "Location name",
  "locationStatus": "attacked|ruined|thriving|locked|changed|reinforced|abandoned",
  "locationDescription": "New one sentence state of this location",
  "affectedFaction": "",
  "factionChange": 0,
  "severity": "minor|moderate|major",
  "badEventForPlayer": null
}
badEventForPlayer: null OR { type: "ambush|bounty", description: "" }`;

const MAP_SYSTEM_PROMPT = `You are a world map generator for a dark anime RPG.
Respond ONLY with valid JSON, no markdown.
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

const RACE_GEN_PROMPT = `You are a race generator for a dark anime RPG world.
Generate the races that exist in this world.
Respond ONLY with valid JSON, no markdown:
{
  "races": [
    {
      "name": "Race Name",
      "appearance": "Brief physical description visible at a glance",
      "statBias": "strength|agility|intelligence|balanced",
      "description": "One sentence about this race's nature"
    }
  ]
}
Generate 4-8 races appropriate to the world setting.
Include at least one common/human-like race and one rare/dangerous race.`;

// ════════════════════════════════════════
// STORY ENDPOINT
// ════════════════════════════════════════
app.post('/story', async (req, res) => {
  try {
    const { messages, worldSetting, playerData,
            worldNPCs, locationStates, worldRaces } = req.body;

    console.log("Story - rank:", playerData?.rank,
      "level:", playerData?.level,
      "location:", playerData?.currentLocation);

    const systemPrompt = buildSystemPrompt(
      playerData || {}, worldSetting,
      worldNPCs || {}, locationStates || {},
      worldRaces || {});

    const response = await fetch(
      model: 'gpt-4.1-mini',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4.1-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            ...(messages || [])
          ],
          max_tokens: 900,
          temperature: 0.85,
        })
      }
    );

    const data = await response.json();
    if (data.error) {
      return res.json({
        narrative: "Error: " + data.error.message,
        gameData: {} });
    }

    const fullText = data.choices?.[0]?.message?.content
      || 'The void offers no response.';
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
        gameData = { ...gameData,
          ...JSON.parse(gameDataMatch[1].trim()) };
      } catch(e) {
        console.error("GameData parse error:", e.message);
      }
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
            gameData.statChanges[k] =
              Math.floor(gameData.statChanges[k] * ratio);
        }
      }
    }

    res.json({ narrative, gameData });
  } catch(e) {
    console.error("Story error:", e.message);
    res.status(500).json({
      narrative: 'The darkness swallows your action.',
      gameData: {} });
  }
});

// ════════════════════════════════════════
// BATTLE ENDPOINT
// ════════════════════════════════════════
app.post('/battle', async (req, res) => {
  try {
    const { playerData, enemy, abilityUsed,
            worldSetting } = req.body;

    console.log("Battle turn - player:",
      playerData?.name, "vs enemy:", enemy?.name,
      "ability:", abilityUsed?.name);

    const abilityStr = abilityUsed
      ? `Player uses: ${abilityUsed.name} (${abilityUsed.description}, damage: ${abilityUsed.damage})`
      : 'Player uses basic attack';

    const context = `World: ${worldSetting}
Player: level ${playerData.level}, rank ${playerData.rank}
Player HP: ${playerData.hp}/${playerData.maxHp}
Player STR: ${playerData.strength}, AGI: ${playerData.agility}, INT: ${playerData.intelligence}
${abilityStr}
Enemy: ${enemy.name} (${enemy.race || 'unknown race'})
Enemy rank: ${enemy.rank}, level: ${enemy.level}
Enemy HP: ${enemy.currentHp}/${enemy.maxHp}
Enemy strongest stat: ${enemy.strongestStat}
Enemy description: ${enemy.description}
Is boss: ${enemy.isBoss ? 'YES' : 'NO'}
Turn number: ${enemy.turnNumber || 1}`;

    const response = await fetch(
      model: 'gpt-4.1-mini',,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4.1-mini',
          messages: [
            { role: 'system', content: BATTLE_PROMPT },
            { role: 'user', content: context }
          ],
          max_tokens: 300,
          temperature: 0.8,
        })
      }
    );

    const data = await response.json();
    if (data.error) {
      return res.status(500).json(
        { error: data.error.message });
    }

    const rawText = data.choices?.[0]?.message?.content
      || '{}';
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

// ════════════════════════════════════════
// WORLD EVENT ENDPOINT
// ════════════════════════════════════════
app.post('/world-event', async (req, res) => {
  try {
    const { worldSetting, worldEvents,
            locationStates, playerRank } = req.body;

    const context = `World: ${worldSetting}
Player rank: ${playerRank || 'E'}
Recent events: ${(worldEvents||[]).slice(-5).join(', ')}
Locations: ${JSON.stringify(locationStates||{}).slice(0,300)}`;

    const response = await fetch(
      model: 'gpt-4.1-mini',,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4.1-mini',
          messages: [
            { role: 'system', content: WORLD_EVENT_PROMPT },
            { role: 'user', content: context }
          ],
          max_tokens: 400,
          temperature: 0.9,
        })
      }
    );

    const data = await response.json();
    if (data.error) {
      return res.status(500).json(
        { error: data.error.message });
    }

    const rawText = data.choices?.[0]?.message?.content
      || '{}';
    const cleanText = rawText
      .replace(/```json/g,'').replace(/```/g,'').trim();

    let eventData;
    try {
      eventData = JSON.parse(cleanText);
    } catch(e) {
      return res.status(500).json(
        { error: "Parse failed" });
    }

    res.json({ eventData });
  } catch(e) {
    console.error("World event error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════
// MAP GENERATION ENDPOINT
// ════════════════════════════════════════
app.post('/generate-map', async (req, res) => {
  try {
    const { worldSetting, layer, layerName } = req.body;

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

    const response = await fetch(
      model: 'gpt-4.1-mini',,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4.1-mini',
          messages: [
            { role: 'system', content: MAP_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: 2000,
          temperature: 0.7,
        })
      }
    );

    const data = await response.json();
    if (data.error) {
      return res.status(500).json(
        { error: data.error.message });
    }

    const rawText = data.choices?.[0]?.message?.content
      || '{}';
    const cleanText = rawText
      .replace(/```json/g,'').replace(/```/g,'').trim();

    let mapData;
    try {
      mapData = JSON.parse(cleanText);
    } catch(e) {
      return res.status(500).json(
        { error: "Failed to parse map" });
    }

    res.json({ mapData });
  } catch(e) {
    console.error("Map error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════
// RACE GENERATION ENDPOINT
// ════════════════════════════════════════
app.post('/generate-races', async (req, res) => {
  try {
    const { worldSetting } = req.body;

    const response = await fetch(
      model: 'gpt-4.1-mini',,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4.1-mini',
          messages: [
            { role: 'system', content: RACE_GEN_PROMPT },
            { role: 'user', content: `Generate races for: ${worldSetting}` }
          ],
          max_tokens: 800,
          temperature: 0.8,
        })
      }
    );

    const data = await response.json();
    if (data.error) {
      return res.status(500).json(
        { error: data.error.message });
    }

    const rawText = data.choices?.[0]?.message?.content
      || '{}';
    const cleanText = rawText
      .replace(/```json/g,'').replace(/```/g,'').trim();

    let raceData;
    try {
      raceData = JSON.parse(cleanText);
    } catch(e) {
      return res.status(500).json(
        { error: "Failed to parse races" });
    }

    res.json({ races: raceData.races || [] });
  } catch(e) {
    console.error("Race gen error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════
// NPC INSPECT ENDPOINT
// ════════════════════════════════════════
app.post('/inspect-npc', async (req, res) => {
  try {
    const { npcName, npcData, worldSetting } = req.body;

    const prompt = `You are an NPC inspector for a dark anime RPG.
Based on what the player knows about this NPC, generate inspection details.
Only reveal what makes sense given their history and relationship.
Respond ONLY with valid JSON:
{
  "name": "Full name or ??? if unknown",
  "race": "Race or ??? if not obvious",
  "age": "Age or ??? if unknown",
  "appearance": "Brief physical description",
  "impression": "What the player senses about this person in one sentence"
}`;

    const context = `NPC: ${npcName}
Known info: ${JSON.stringify(npcData || {})}
World: ${worldSetting}
Player is inspecting this NPC. Reveal only what is naturally observable.`;

    const response = await fetch(
      model: 'gpt-4.1-mini',,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4.1-mini',
          messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: context }
          ],
          max_tokens: 200,
          temperature: 0.7,
        })
      }
    );

    const data = await response.json();
    if (data.error) {
      return res.status(500).json(
        { error: data.error.message });
    }

    const rawText = data.choices?.[0]?.message?.content
      || '{}';
    const cleanText = rawText
      .replace(/```json/g,'').replace(/```/g,'').trim();

    let inspectData;
    try {
      inspectData = JSON.parse(cleanText);
    } catch(e) {
      return res.status(500).json(
        { error: "Parse failed" });
    }

    res.json({ inspectData });
  } catch(e) {
    console.error("Inspect error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/ping', (req, res) => {
  res.json({ status: 'alive' });
});

app.listen(process.env.PORT || 3000,
  () => console.log('Proxy running'));
