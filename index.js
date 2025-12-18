import Anthropic from '@anthropic-ai/sdk';
import express from 'express';
import 'dotenv/config';

// ... rest of the code stays the same
const app = express();
app.use(express.json());

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'Voice AI Secretary is running!' });
});

// Webhook endpoint for Vapi
app.post('/webhook', async (req, res) => {
  console.log('Received webhook:', req.body);
  
  const { message, conversationHistory = [] } = req.body;
  
  try {
    // Build messages array for Claude
    const messages = conversationHistory.map(msg => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content
    }));
    
    // Add current message
    messages.push({ role: 'user', content: message });
    
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 150,
      system: `You are a professional, friendly voice secretary. Keep responses very brief (1-2 sentences max) since this is a phone call. Speak naturally and conversationally.`,
      messages: messages,
    });
    
    const reply = response.content[0].text;
    console.log('Claude response:', reply);
    
    res.json({ response: reply });
    
  } catch (error) {
    console.error('Error calling Claude:', error);
    res.status(500).json({ 
      response: "I'm having trouble processing that. Could you try again?" 
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
