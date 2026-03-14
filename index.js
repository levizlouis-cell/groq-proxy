const express = require('express');
const app = express();
app.use(express.json());

const STORY_SYSTEM_PROMPT = `You are the narrator and world of a dark anime text adventure game. 
The player is the protagonist. You play every NPC, enemy, and event in the world.
You NEVER break character. You NEVER refuse to continue the story.
You respond in 2-4 paragraphs of vivid dark anime narrative.
At the end of every response add a JSON block in this exact format:
<GAMEDATA>
{
  "statChanges": { "hp": 0, "strength": 0, "agility": 0, "intelligence": 0, "rank": "" },
  "inventoryAdd": [],
  "inventoryRemove": [],
  "worldEvent": "",
  "currentLocation": "",
  "currentLayer": 0
}
</GAMEDATA>
Rules:
- Only put non-zero values in statChanges when something actually changes.
- rank only changes on promotion: E, D, C, B, A, S.
- worldEvent is one sentence summary of what happened.
- currentLocation is the exact name of where the player is RIGHT NOW.
- currentLayer is a number: 2=sky, 1=elevated, 0=ground, -1=cave, -2=dungeon, -3=abyss.
- currentLayer changes when player physically moves to a different vertical level.
- Keep narrative dark, intense, cinematic like Solo Leveling or Tower of God.`;

const MAP_SYSTEM_PROMPT = `You are a world map generator for a dark anime text adventure game.
Generate a detailed map for the given layer of the player's world.
You MUST respond with ONLY a valid JSON object, no other text, no markdown, no explanation.
The JSON must follow this exact format:
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
      "isStarting": false
    }
  ]
}
Rules:
- Generate 20-25 locations for layer 0 (ground).
- Generate 10-15 locations for all other layers.
- x and y are 0-100 representing position on the map canvas.
- Spread locations across the full 0-100 range on both axes.
- connections are ids of directly connected locations (2-4 connections per location).
- Exactly ONE location must have isStarting: true — this is where the player begins.
- Make location names fit the world theme provided.
- Types: city=large settlement, dungeon=dangerous place, wilderness=open area,
  landmark=notable feature, sanctuary=safe rest point, ruins=ancient remains,
  fortress=military stronghold, village=small settlement, market=trade hub, portal=gateway.`;

// Story endpoint
app.post('/story', async (req, res) => {
  try {
    const { messages, worldSetting, playerData } = req.body;

    console.log("Story request for world:", worldSetting?.slice(0, 50));
    console.log("Message count:", messages?.length);
    console.log("API key present:", !!process.env.GROQ_API_KEY);

    const contextPrompt = `
World Setting: ${worldSetting || 'Unknown world'}
Player Stats: ${JSON.stringify(playerData || {})}
Current Location: ${playerData?.currentLocation || 'Unknown'}
Current Layer: ${playerData?.currentLayer ?? 0}
`;

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
            { role: 'system', content: STORY_SYSTEM_PROMPT + contextPrompt },
            ...(messages || [])
          ],
          max_tokens: 700,
          temperature: 0.85,
        })
      }
    );

    console.log("Groq story status:", response.status);
    const data = await response.json();

    if (data.error) {
      console.error("Groq error:", data.error.message);
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
      currentLayer: null
    };

    if (gameDataMatch) {
      try {
        gameData = JSON.parse(gameDataMatch[1].trim());
      } catch(e) {
        console.error("GameData parse error:", e.message);
      }
    }

    res.json({ narrative, gameData });

  } catch(e) {
    console.error("Story server error:", e.message);
    res.status(500).json({
      narrative: 'The darkness swallows your action whole.',
      gameData: {}
    });
  }
});

// Map generation endpoint
app.post('/generate-map', async (req, res) => {
  try {
    const { worldSetting, layer, layerName } = req.body;

    console.log("Map generation request - layer:", layer, "world:", worldSetting?.slice(0, 50));

    const userPrompt = `Generate a map for layer ${layer} (${layerName}) of this world: ${worldSetting}. 
Make the locations thematically appropriate for both the world setting and the layer type.
For layer ${layer}: ${getLayerContext(layer)}`;

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

    console.log("Groq map status:", response.status);
    const data = await response.json();

    if (data.error) {
      console.error("Map gen error:", data.error.message);
      return res.status(500).json({ error: data.error.message });
    }

    const rawText = data.choices?.[0]?.message?.content || '{}';
    console.log("Raw map response:", rawText.slice(0, 200));

    // Strip any markdown if present
    const cleanText = rawText
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();

    let mapData;
    try {
      mapData = JSON.parse(cleanText);
    } catch(e) {
      console.error("Map JSON parse error:", e.message);
      return res.status(500).json({ error: "Failed to parse map data" });
    }

    res.json({ mapData });

  } catch(e) {
    console.error("Map server error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

function getLayerContext(layer) {
  const contexts = {
    2:  "This is the high sky and celestial realm. Locations should include floating islands, cloud citadels, celestial gates, storm peaks, and divine sanctuaries.",
    1:  "This is elevated terrain — mountain peaks, high plateaus, and rooftops. Locations should include mountain sects, peak fortresses, eagle nests, and high temples.",
    0:  "This is ground level — the main world. Include cities, villages, wilderness areas, ruins, markets, and landmarks.",
    "-1": "This is underground — caves, tunnels, and shallow subterranean spaces. Include cave systems, underground rivers, buried ruins, and hidden sanctuaries.",
    "-2": "This is deep dungeon level. Include ancient dungeons, cursed vaults, creature lairs, trapped corridors, and boss chambers.",
    "-3": "This is the abyss — the deepest and most dangerous layer. Include void rifts, demon realms, ancient prisons, and places of unspeakable power."
  };
  return contexts[layer.toString()] || "Generate appropriate locations for this layer.";
}

app.get('/ping', (req, res) => {
  res.json({ status: 'alive' });
});

app.listen(process.env.PORT || 3000,
  () => console.log('Proxy running'));
