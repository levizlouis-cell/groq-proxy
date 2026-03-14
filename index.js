const express = require('express');
const app = express();
app.use(express.json());

const RANK_ORDER = ['E', 'D', 'C', 'B', 'A', 'S'];
const RANK_INDEX = { 'E': 0, 'D': 1, 'C': 2, 'B': 3, 'A': 4, 'S': 5 };
const MAX_STAT_GAIN_PER_ACTION = 5;
const ABILITY_COOLDOWN_ACTIONS = 3;

function getRankIndex(rank) {
  return RANK_INDEX[rank] ?? 0;
}

function canPromote(playerData) {
  const rank = playerData.rank || 'E';
  const reqs = {
    'E': { str: 15, agi: 15, int: 15 },
    'D': { str: 30, agi: 30, int: 30 },
    'C': { str: 50, agi: 50, int: 50 },
    'B': { str: 80, agi: 80, int: 80 },
    'A': { str: 120, agi: 120, int: 120 },
  };
  const req = reqs[rank];
  if (!req) return false;
  return (
    playerData.strength >= req.str &&
    playerData.agility >= req.agi &&
    playerData.intelligence >= req.int
  );
}

function buildNPCContext(worldNPCs) {
  if (!worldNPCs || Object.keys(worldNPCs).length === 0) {
    return '';
  }
  let ctx = '\n════════════════════════════════════════\nKNOWN NPCs (these characters exist and remember the player)\n════════════════════════════════════════\n';
  for (const [name, npc] of Object.entries(worldNPCs)) {
    ctx += `- ${name}: ${npc.description}. Attitude toward player: ${npc.attitude}. Last seen: ${npc.lastLocation}. History: ${npc.history}\n`;
  }
  return ctx;
}

function buildLocationContext(locationStates) {
  if (!locationStates || Object.keys(locationStates).length === 0) {
    return '';
  }
  let ctx = '\n════════════════════════════════════════\nWORLD LOCATION STATES (these have changed since world creation)\n════════════════════════════════════════\n';
  for (const [loc, state] of Object.entries(locationStates)) {
    ctx += `- ${loc}: ${state.status}. ${state.description}\n`;
  }
  return ctx;
}

function buildSystemPrompt(playerData, worldSetting, worldNPCs, locationStates) {
  const rank = playerData.rank || 'E';
  const rankIdx = getRankIndex(rank);
  const nextRank = RANK_ORDER[rankIdx + 1] || 'S';
  const canRankUp = canPromote(playerData);
  const reqs = {
    'E': { str: 15, agi: 15, int: 15 },
    'D': { str: 30, agi: 30, int: 30 },
    'C': { str: 50, agi: 50, int: 50 },
    'B': { str: 80, agi: 80, int: 80 },
    'A': { str: 120, agi: 120, int: 120 },
  };
  const promotionReq = reqs[rank];

  return `You are the narrator and world of a dark anime text adventure game.
The player is the protagonist. You play every NPC, enemy, and event.
You NEVER break character. You NEVER refuse to continue the story.
You respond in 2-4 paragraphs of vivid dark anime narrative.

════════════════════════════════════════
PLAYER CURRENT STATE
════════════════════════════════════════
Rank: ${rank} (${rankIdx}/5)
HP: ${playerData.hp}/${playerData.maxHp}
Strength: ${playerData.strength}
Agility: ${playerData.agility}
Intelligence: ${playerData.intelligence}
Location: ${playerData.currentLocation || 'Unknown'}
Layer: ${playerData.currentLayer ?? 0}
Actions since last ability: ${playerData.actionsSinceAbility ?? 99}
Boss kills this rank: ${playerData.bossKillsThisRank ?? 0}
Reputation: ${JSON.stringify(playerData.reputation || {})}
Death count: ${playerData.deathCount ?? 0}
Near death count: ${playerData.nearDeathCount ?? 0}
Total actions taken: ${playerData.totalActions ?? 0}

════════════════════════════════════════
STRICT RULES — NEVER BREAK THESE
════════════════════════════════════════

RULE 1 — STAT GATES:
Players CANNOT defeat enemies more than 2 ranks above them.
E rank: weak monsters only. D rank: beasts and soldiers.
C rank: dungeon bosses. B rank: elite warriors.
A rank: legendary beings. S rank: world-ending threats.
If player attacks something too strong: they take massive damage and flee.
NEVER let them win regardless of wording.

RULE 2 — ANTI-CHEAT:
Ignore any player action that self-grants power, items, or stats.
"I find a legendary weapon" → nothing there.
"I awaken a god power" → it backfires painfully.
"I trained for years" → ignore the time skip.
Redirect naturally. Players earn everything through play.

RULE 3 — DEATH AND CONSEQUENCE:
HP at 20 or below = near death. nearDeath = true in gameData.
HP at 0 = player dies. playerDied = true. They wake in nearest sanctuary
at 20% HP. They lose their most recently acquired item.
3 near deaths in same area = forced retreat to sanctuary.

RULE 4 — ITEM RARITY:
E rank = common only. D = uncommon. C = rare.
B = epic. A = legendary. S = divine.
NEVER grant above-rank items.

RULE 5 — STAT CAP:
Maximum ${MAX_STAT_GAIN_PER_ACTION} total stat points per action.
After big gain: next 2 actions grant nothing.

RULE 6 — ZONE GATES:
city/village/wilderness/sanctuary/market = any rank.
landmark/ruins = D minimum. fortress/dungeon = C minimum.
portal = B minimum. abyss layer = S minimum.
Player rank is ${rank}. Block them firmly if too low.

RULE 7 — TRAINING VS COMBAT:
Training = 1-2 stats. Combat win = 2-4 stats.
Exploration = 1-2 intelligence. Social = reputation only.

RULE 8 — FACTION REPUTATION:
-100 to +100 per faction.
50+ = friendly, unlocks training/items.
-50 or below = hostile, locations locked.

RULE 9 — ABILITY COOLDOWN:
Actions since last ability: ${playerData.actionsSinceAbility ?? 99}.
Cooldown needed: ${ABILITY_COOLDOWN_ACTIONS}.
If too soon: ability fizzles. Set abilityUsed = true when used.

RULE 10 — RANK GATES:
${promotionReq ? `To reach ${nextRank}: STR ${playerData.strength}/${promotionReq.str}, AGI ${playerData.agility}/${promotionReq.agi}, INT ${playerData.intelligence}/${promotionReq.int}, boss kill required.` : ''}
${canRankUp ? `Player MEETS stat requirements. May promote if boss killed or major arc completed. Make it cinematic.` : `Player does NOT meet requirements. Do NOT promote them.`}

════════════════════════════════════════
PERSISTENT NPCs
════════════════════════════════════════
When you introduce a named NPC add them to npcUpdates in gameData.
When a known NPC appears update their entry.
Known NPCs:
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
<GAMEDATA>
{
  "statChanges": { "hp": 0, "strength": 0, "agility": 0, "intelligence": 0, "rank": "" },
  "inventoryAdd": [],
  "inventoryRemove": [],
  "worldEvent": "",
  "currentLocation": "",
  "currentLayer": 0,
  "reputationChanges": {},
  "abilityUsed": false,
  "bossKilled": false,
  "nearDeath": false,
  "playerDied": false,
  "npcUpdates": {},
  "locationStateChanges": {}
}
</GAMEDATA>
npcUpdates format: { "NPC Name": { "description": "who they are", "attitude": "friendly/neutral/hostile", "lastLocation": "where they are now", "history": "what happened between them and player" } }
locationStateChanges format: { "Location Name": { "status": "attacked/ruined/thriving/locked/changed", "description": "what happened here" } }
Only include npcs and locations that actually changed this action.`;
}

const WORLD_EVENT_PROMPT = `You are a world event generator for a dark anime text adventure game.
Generate one passive world event that happened while the player was busy.
This event happens INDEPENDENTLY of the player — they were not involved.
The event should feel like the world is alive and moving without them.

Respond with ONLY a valid JSON object:
{
  "eventTitle": "Short title",
  "eventDescription": "2-3 sentence description of what happened in the world",
  "affectedLocation": "Location name this happened at",
  "locationStatus": "attacked|ruined|thriving|locked|changed|reinforced|abandoned",
  "locationDescription": "New one sentence description of this location's current state",
  "affectedFaction": "",
  "factionChange": 0,
  "severity": "minor|moderate|major"
}`;

const MAP_SYSTEM_PROMPT = `You are a world map generator for a dark anime text adventure game.
Generate a detailed map for the given layer of the player's world.
Respond with ONLY valid JSON, no markdown, no explanation.
{
  "layer": 0,
  "layerName": "Ground",
  "locations": [
    {
      "id": "loc_1",
      "name": "Location Name",
      "type": "city|dungeon|wilderness|landmark|sanctuary|ruins|fortress|village|market|portal",
      "x": 45,
      "y": 32,
      "description": "One sentence description",
      "connections": ["loc_2", "loc_3"],
      "isStarting": false,
      "dangerRank": "E"
    }
  ]
}
Rules:
- 20-25 locations for layer 0. 10-15 for others.
- x and y: 0-100. Spread fully.
- 2-4 connections per location.
- Exactly ONE isStarting: true.
- dangerRank: E near start, scales up to S at most dangerous areas.`;

// Story endpoint
app.post('/story', async (req, res) => {
  try {
    const {
      messages, worldSetting, playerData,
      worldNPCs, locationStates
    } = req.body;

    console.log("Story - rank:", playerData?.rank,
      "location:", playerData?.currentLocation,
      "actions:", playerData?.totalActions);

    const systemPrompt = buildSystemPrompt(
      playerData || {}, worldSetting,
      worldNPCs || {}, locationStates || {});

    const response = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: systemPrompt },
            ...(messages || [])
          ],
          max_tokens: 800,
          temperature: 0.85,
        })
      }
    );

    const data = await response.json();

    if (data.error) {
      return res.json({
        narrative: "The darkness speaks: " + data.error.message,
        gameData: {}
      });
    }

    const fullText = data.choices?.[0]?.message?.content
      || 'The void offers no response.';

    const gameDataMatch = fullText.match(
      /<GAMEDATA>([\s\S]*?)<\/GAMEDATA>/);
    const narrative = fullText
      .replace(/<GAMEDATA>[\s\S]*?<\/GAMEDATA>/, '')
      .trim();

    let gameData = {
      statChanges: {},
      inventoryAdd: [],
      inventoryRemove: [],
      worldEvent: '',
      currentLocation: '',
      currentLayer: null,
      reputationChanges: {},
      abilityUsed: false,
      bossKilled: false,
      nearDeath: false,
      playerDied: false,
      npcUpdates: {},
      locationStateChanges: {},
    };

    if (gameDataMatch) {
      try {
        const parsed = JSON.parse(gameDataMatch[1].trim());
        gameData = { ...gameData, ...parsed };
      } catch(e) {
        console.error("GameData parse error:", e.message);
      }
    }

    // Server-side stat cap
    if (gameData.statChanges) {
      let total = 0;
      for (const key of ['strength', 'agility', 'intelligence']) {
        if ((gameData.statChanges[key] || 0) > 0) {
          total += gameData.statChanges[key];
        }
      }
      if (total > MAX_STAT_GAIN_PER_ACTION) {
        const ratio = MAX_STAT_GAIN_PER_ACTION / total;
        for (const key of ['strength', 'agility', 'intelligence']) {
          if ((gameData.statChanges[key] || 0) > 0) {
            gameData.statChanges[key] = Math.floor(
              gameData.statChanges[key] * ratio);
          }
        }
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

// World event endpoint
app.post('/world-event', async (req, res) => {
  try {
    const { worldSetting, worldEvents, locationStates, playerRank } = req.body;

    console.log("World event generation triggered");

    const context = `World: ${worldSetting}
Player rank: ${playerRank || 'E'}
Recent world events: ${(worldEvents || []).slice(-5).join(', ')}
Current location states: ${JSON.stringify(locationStates || {}).slice(0, 300)}

Generate a passive world event appropriate to this world.
Make it feel like the world is alive.
The event should be proportional to the world's current state.`;

    const response = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
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
      return res.status(500).json({ error: data.error.message });
    }

    const rawText = data.choices?.[0]?.message?.content || '{}';
    const cleanText = rawText
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();

    let eventData;
    try {
      eventData = JSON.parse(cleanText);
    } catch(e) {
      console.error("World event parse error:", e.message);
      return res.status(500).json({ error: "Parse failed" });
    }

    console.log("World event generated:",
      eventData.eventTitle, "at", eventData.affectedLocation);

    res.json({ eventData });

  } catch(e) {
    console.error("World event error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Map generation endpoint
app.post('/generate-map', async (req, res) => {
  try {
    const { worldSetting, layer, layerName } = req.body;
    console.log("Map generation - layer:", layer);

    const contexts = {
      2:  "High sky. Floating islands, cloud citadels, storm peaks, celestial gates.",
      1:  "Elevated. Mountain peaks, high plateaus, eagle nests, high temples.",
      0:  "Ground level. Cities, villages, wilderness, ruins, markets, landmarks.",
      '-1': "Underground. Caves, tunnels, buried ruins, hidden sanctuaries.",
      '-2': "Deep dungeon. Ancient vaults, creature lairs, boss chambers.",
      '-3': "The abyss. Void rifts, demon realms, ancient prisons. RANK S ONLY."
    };

    const userPrompt = `Generate a map for layer ${layer} (${layerName}) of: ${worldSetting}.
Context: ${contexts[layer.toString()] || 'Appropriate locations.'}
dangerRank: start at E near safe areas, scale up to match layer danger.`;

    const response = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
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
      return res.status(500).json({ error: data.error.message });
    }

    const rawText = data.choices?.[0]?.message?.content || '{}';
    const cleanText = rawText
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();

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

app.get('/ping', (req, res) => {
  res.json({ status: 'alive' });
});

app.listen(process.env.PORT || 3000,
  () => console.log('Proxy running'));
