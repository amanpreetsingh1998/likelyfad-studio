<div align="center">

### Likelyfad Studio

AI-powered creative production workflows.

Build image, video, audio, and 3D generation pipelines by connecting nodes on a visual canvas.

[**Live App**](https://likelyfad-studio.vercel.app) &nbsp;&bull;&nbsp; [X / Twitter](https://x.com/amanxdesign) &nbsp;&bull;&nbsp; [Instagram](https://www.instagram.com/)

</div>

## What Is This

Likelyfad Studio is a visual node-based workflow editor for AI media generation. Drag nodes onto an infinite canvas, connect them, and run pipelines that call AI APIs in dependency order.

Built for creative production — product shots, lifestyle images, color variations, video, and more.

## Features

| Feature | Description |
|:--------|:------------|
| **Dynamic Prompting** | Build prompts with variables, LLM-powered text construction, and reusable prompt chains |
| **Prompt to Workflow** | Generate complete workflows from natural language descriptions |
| **Visual Node Editor** | Drag-and-drop nodes onto an infinite canvas with pan and zoom |
| **Image Generation** | Generate images using Google Gemini, Replicate, fal.ai, Kie.ai, and more |
| **Video Generation** | Generate video via AI API providers |
| **Audio Generation** | Text-to-speech and AI audio generation |
| **3D Generation** | Generate 3D models or use them as node inputs |
| **Image Annotation** | Full-screen editor with drawing tools (rectangles, circles, arrows, freehand, text) |
| **Text Generation** | Generate text using Google Gemini, OpenAI, or Anthropic models |
| **Workflow Chaining** | Connect multiple nodes to create complex multi-step pipelines |

## Supported Providers

| Provider | Status |
|:---------|:-------|
| [Google Gemini](https://ai.google.dev/) | Fully supported |
| [Replicate](https://replicate.com/) | Supported |
| [fal.ai](https://fal.ai/) | Supported |
| [Kie.ai](https://kie.ai/) | Supported |
| [WaveSpeed](https://wavespeed.ai/) | Supported |
| [OpenAI](https://openai.com/) | LLM only |

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Quick Start

```bash
git clone https://github.com/amanpreetsingh1998/likelyfad-studio.git
cd likelyfad-studio
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Environment Variables

Create a `.env.local` file in the root directory:

```env
APP_PASSWORD=your_password                   # Required for deployed app
GEMINI_API_KEY=your_gemini_api_key          # Required for prompt-to-workflow
OPENAI_API_KEY=your_openai_api_key          # Optional
ANTHROPIC_API_KEY=your_anthropic_api_key    # Optional
REPLICATE_API_KEY=your_replicate_api_key    # Optional
FAL_API_KEY=your_fal_api_key                # Optional
KIE_API_KEY=your_kie_api_key                # Optional
WAVESPEED_API_KEY=your_wavespeed_api_key    # Optional
```

API keys can also be configured in Project Settings within the app.

## Tech Stack

Next.js 16 &bull; React 19 &bull; TypeScript &bull; React Flow &bull; Zustand &bull; TailwindCSS &bull; Konva.js &bull; Three.js

## Credits

Based on [Node Banana](https://github.com/shrimbly/node-banana) by Willie — MIT licensed.

## License

MIT
