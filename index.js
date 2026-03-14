const express = require('express');
const app = express();
app.use(express.json());

app.post('/story', async (req, res) => {
  try {
    const { messages, systemPrompt } = req.body;
    const response = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama3-70b-8192',
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages
          ],
          max_tokens: 400,
          temperature: 0.8,
        })
      }
    );
    const data = await response.json();
    res.json({
      text: data.choices?.[0]?.message?.content
        || 'The world is silent...'
    });
  } catch(e) {
    res.status(500).json({ text: 'Error reaching the void.' });
  }
});

app.get('/ping', (req, res) => {
  res.json({ status: 'alive' });
});

app.listen(process.env.PORT || 3000,
  () => console.log('Proxy running'));
