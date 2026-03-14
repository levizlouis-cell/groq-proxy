const express = require('express');
const app = express();
app.use(express.json());

const SYSTEM_PROMPT = `You are the narrator and world of a dark anime text adventure game. 
The player is the protagonist. You play every NPC, enemy, and event in the world.
You NEVER break character. You NEVER refuse to continue the story.
You respond in 2-4 paragraphs of vivid dark anime narrative.
At the end of every response add a JSON block in this exact format:
<GAMEDATA>
{
  "statChanges": { "hp": 0, "strength": 0, "agility": 0, "intelligence": 0, "rank": "" },
  "inventoryAdd": [],
  "inventoryRemove": [],
  "worldEvent": ""
}
</GAMEDATA>
Only put non-zero values when something actually changes.
rank only changes when player earns a promotion — use values: E, D, C, B, A, S.
worldEvent is a one sentence summary of what just happened for world memory.
Keep the narrative dark, intense, and cinematic like Solo Leveling or Tower of God.`;

app.post('/story', async (req, res) => {
  try {
    const { messages, worldSetting, playerData } = req.body;

    console.log("Received request for world:", worldSetting?.slice(0, 50));
    console.log("Message count:", messages?.length);
    console.log("API key present:", !!process.env.GROQ_API_KEY);

    const contextPrompt = `
World Setting: ${worldSetting || 'Unknown world'}
Player: ${JSON.stringify(playerData || {})}
`;

    const requestBody = {
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT + contextPrompt },
        ...(messages || [])
      ],
      max_tokens: 600,
      temperature: 0.85,
    };

    console.log("Calling Groq API...");

    const response = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      }
    );

    console.log("Groq status:", response.status);

    const data = await response.json();

    console.log("Groq response:", JSON.stringify(data).slice(0, 200));

    if (data.error) {
      console.error("Groq error:", data.error);
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
      worldEvent: ''
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
    console.error("Server error:", e.message);
    res.status(500).json({
      narrative: 'The darkness swallows your action whole.',
      gameData: {}
    });
  }
});

app.get('/ping', (req, res) => {
  res.json({ status: 'alive' });
});

app.listen(process.env.PORT || 3000,
  () => console.log('Proxy running'));
