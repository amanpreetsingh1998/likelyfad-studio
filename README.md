<div align="center">

<img width="full" alt="Node Banana" src="public/node-banana.png" />

### The Visual Workflow Editor for AI Image Generation

[![GitHub stars](https://img.shields.io/github/stars/shrimbly/node-banana?style=flat&logo=github)](https://github.com/shrimbly/node-banana/stargazers)
[![License](https://img.shields.io/github/license/shrimbly/node-banana?style=flat)](LICENSE)
[![Discord](https://img.shields.io/badge/Discord-555?logo=discord)](https://discord.com/invite/89Nr6EKkTf)

<br />

Build AI image and video generation pipelines by connecting nodes on a visual canvas.<br />
Multi-provider support. Prompt-to-workflow generation. Built mainly with Claude.

<br />

[**Documentation**](https://node-banana-docs.vercel.app/) &nbsp;&bull;&nbsp; [Discord](https://discord.com/invite/89Nr6EKkTf)

<br />

</div>

## Build Complex AI Pipelines Visually

Node Banana is a node-based workflow editor for AI image generation. Drag nodes onto an infinite canvas, connect them with typed handles, and execute pipelines that call AI APIs in dependency order.

- **Generate workflows from natural language** or choose from preset templates
- **Chain multiple AI models together** across providers in a single pipeline
- **Annotate and edit images** with a full-screen drawing editor
- **Lock node groups** to skip them during execution
- **Save and share workflows** as portable JSON files

## Features

| Feature | Description |
|:--------|:------------|
| **Prompt to Workflow** | Generate complete workflows from natural language descriptions |
| **Visual Node Editor** | Drag-and-drop nodes onto an infinite canvas with pan and zoom |
| **Image Annotation** | Full-screen editor with drawing tools (rectangles, circles, arrows, freehand, text) |
| **AI Image Generation** | Generate images using Google Gemini, Replicate, fal.ai, Kie.ai, and more |
| **Text Generation** | Generate text using Google Gemini or OpenAI models |
| **Workflow Chaining** | Connect multiple nodes to create complex multi-step pipelines |
| **Group Locking** | Lock node groups to skip them during execution |
| **Save/Load** | Export and import workflows as JSON files |

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
git clone https://github.com/shrimbly/node-banana.git
cd node-banana
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Environment Variables

Create a `.env.local` file in the root directory:

```env
GEMINI_API_KEY=your_gemini_api_key          # Required for prompt-to-workflow
OPENAI_API_KEY=your_openai_api_key          # Optional
ANTHROPIC_API_KEY=your_anthropic_api_key    # Optional
REPLICATE_API_KEY=your_replicate_api_key    # Optional
FAL_API_KEY=your_fal_api_key                # Optional
KIE_API_KEY=your_kie_api_key                # Optional
WAVESPEED_API_KEY=your_wavespeed_api_key    # Optional
```

API keys can also be configured per-project in Project Settings within the app.

### Build

```bash
npm run build
npm run start
```

## Example Workflows

The `/examples` directory contains example workflow files. To try them:

1. Start the dev server with `npm run dev`
2. Drag any `.json` file from the `/examples` folder into the browser window
3. Review the prompts in each node before running — they're targeted to specific use cases

## Node Types

| Type | Purpose |
|:-----|:--------|
| **Image Input** | Load or upload reference images |
| **Prompt** | Text prompt input |
| **Generate** | AI image generation (multi-provider) |
| **LLM** | AI text generation |
| **Annotation** | Draw on images with full-screen editor |
| **Split Grid** | Split image into grid cells |
| **Audio** | AI audio/TTS generation |
| **Output** | Display final result |

## Tech Stack

<p>
  <a href="https://nextjs.org/"><img src="https://img.shields.io/badge/Next.js-000000?logo=next.js&logoColor=white" alt="Next.js" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://reactflow.dev/"><img src="https://img.shields.io/badge/React%20Flow-FF0072?logo=react&logoColor=white" alt="React Flow" /></a>
  <a href="https://konvajs.org/"><img src="https://img.shields.io/badge/Konva.js-0D83CD?logo=konva&logoColor=white" alt="Konva.js" /></a>
  <a href="https://zustand-demo.pmnd.rs/"><img src="https://img.shields.io/badge/Zustand-443E38?logo=react&logoColor=white" alt="Zustand" /></a>
  <a href="https://tailwindcss.com/"><img src="https://img.shields.io/badge/Tailwindcss-%2338B2AC.svg?logo=tailwind-css&logoColor=white" alt="TailwindCSS" /></a>
</p>

## Testing

```bash
npm test              # Watch mode
npm run test:run      # Single run
npm run test:coverage # With coverage report
```

## Contributing

PRs are welcome! Please branch from `develop` and target `develop` with your PR.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request targeting `develop`

Note: This is primarily built for my own workflows. If a PR conflicts with my plans I'll politely decline. For larger contributions, join the [Discord](https://discord.com/invite/89Nr6EKkTf) to coordinate.

## Community

- **[Discord](https://discord.com/invite/89Nr6EKkTf)** — Chat, get help, and share workflows
- **[Documentation](https://node-banana-docs.vercel.app/)** — Guides and reference
- **[GitHub Issues](https://github.com/shrimbly/node-banana/issues)** — Report bugs and request features

## License

MIT
