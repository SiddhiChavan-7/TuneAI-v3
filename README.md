# 🎵 TuneAI: Your Personal AI DJ

TuneAI is a highly advanced, context-aware web application that acts as your personal radio DJ. Instead of relying on basic keyword searches, TuneAI uses **LLaMA-3 via Groq** to understand the deep emotional context of your prompts and curates highly personalized playlists tailored to your exact taste profile.

##  Key Features & Innovation

* **Conversational AI Curation (Powered by LLaMA-3)**
  Unlike standard search engines or music apps, TuneAI doesn't rely on basic keyword matching. Users can describe wildly specific, hyper-nuanced scenarios (e.g., *"I'm going on a road trip through the desert at night and feel nostalgic"*). The integrated Large Language Model analyzes the human emotion and logic behind the prompt to autonomously select the perfect instruments, tempos, and tracks for that exact moment.

* **Context-Aware Personalization**
  Through secure Google OAuth 2.0 integration, TuneAI directly scans the user's actual YouTube "Liked Videos" library. The AI intelligently anchors its generations using this historical data. As a result, if five different people request the exact same "Upbeat" mood, TuneAI will dynamically generate five completely different playlists, each filtered perfectly through their unique musical taste profile.

* **Premium "Studio" Dashboard & Sticky Player**
  The frontend is built with a highly responsive, modern React architecture. It features flexible sidebar navigation, a sleek YouTube-Red glassmorphism aesthetic, and a continuous "Sticky Bottom Player." This custom player seamlessly embeds the YouTube music video directly into the UI, allowing users to listen and watch without ever leaving the application environment.

* **One-Click YouTube Export**
  Once the AI generates the perfect session, users can click a single button to instantly create a new private playlist and populate it directly into their real YouTube account using the robust YouTube Data API.

* **Intelligent Concurrency Control**
  To handle massive 30-track generation bursts, the Node.js backend implements smart sequential processing algorithms. This ensures the YouTube Data API is protected against HTTP 429 Rate Limit architectures, keeping the app stable and efficient.

##  Tech Stack

- **Frontend:** React.js, Custom CSS Glassmorphism
- **Backend:** Node.js, Express.js
- **AI Integration:** Groq API (LLaMA-3-70B)
- **Authentication & Data:** Google OAuth 2.0, YouTube Data API v3
