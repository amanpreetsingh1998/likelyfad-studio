"use client";

/**
 * The left half of the sign-in screen: the canvas, standing still.
 *
 * Everything here is borrowed from the real editor rather than invented, so
 * the first screen looks like the product rather than a landing page bolted
 * onto it — the #171717 canvas, its 20px #404040 dot grid (WorkflowCanvas.tsx
 * Background), neutral-800 cards with neutral-700 borders (BaseNode.tsx), the
 * minimap's per-node-type colours, and the handle colours from globals.css:
 * image #10b981, text #3b82f6, audio #a855f7, video #ec4899, 3D #f97316.
 *
 * Purely decorative — aria-hidden, and hidden outright below lg, where the
 * panel alone should have the width.
 */

/** Matches getNodeColor() in WorkflowCanvas.tsx. */
const NODE = {
  prompt: "#f97316",
  imageInput: "#3b82f6",
  generate: "#22c55e",
  llm: "#06b6d4",
  output: "#ef4444",
} as const;

/** Matches the --handle-color-* custom properties in globals.css. */
const HANDLE = {
  image: "#10b981",
  text: "#3b82f6",
  audio: "#a855f7",
  video: "#ec4899",
  model3d: "#f97316",
} as const;

interface GraphNodeProps {
  x: number;
  y: number;
  label: string;
  accent: string;
  w?: number;
}

/** A node card, drawn the way BaseNode draws one. */
function GraphNode({ x, y, label, accent, w = 108 }: GraphNodeProps) {
  const h = 34;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={8}
        fill="#262626"
        stroke="#404040"
        strokeWidth={1}
      />
      {/* The type stripe down the left edge, in the minimap colour. */}
      <rect x={x} y={y + 8} width={3} height={h - 16} rx={1.5} fill={accent} />
      <text
        x={x + 14}
        y={y + h / 2 + 3.5}
        fill="#d4d4d4"
        fontSize={10}
        fontFamily="system-ui, sans-serif"
      >
        {label}
      </text>
    </g>
  );
}

/** A bezier between two handles, the shape React Flow draws. */
function Edge({
  from,
  to,
  color,
}: {
  from: [number, number];
  to: [number, number];
  color: string;
}) {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const dx = Math.max(28, Math.abs(x2 - x1) * 0.55);
  return (
    <>
      <path
        d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeOpacity={0.75}
      />
      <circle cx={x1} cy={y1} r={3} fill={color} />
      <circle cx={x2} cy={y2} r={3} fill={color} />
    </>
  );
}

const CAPABILITIES: { label: string; color: string }[] = [
  { label: "Images", color: HANDLE.image },
  { label: "Video", color: HANDLE.video },
  { label: "Audio", color: HANDLE.audio },
  { label: "3D", color: HANDLE.model3d },
  { label: "Text", color: HANDLE.text },
];

export function SignInSplash() {
  return (
    <div
      aria-hidden="true"
      className="relative hidden flex-1 select-none overflow-hidden border-r border-neutral-800 bg-[#171717] lg:flex lg:flex-col lg:justify-between"
    >
      {/* The canvas dot grid — same colour, gap and dot size as the editor. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(#404040 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      />
      {/* Lifts the panel edge out of the flat grid without inventing a colour. */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-neutral-950/70" />

      <div className="relative flex flex-1 flex-col justify-center gap-10 px-14 py-16">
        <div className="max-w-md">
          <h2 className="text-3xl font-medium leading-tight text-neutral-100">
            Build pipelines,
            <br />
            not prompts.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-neutral-400">
            A node based workflow editor for generative AI. Connect nodes to build
            pipelines that transform and generate images, video, audio and 3D
            assets.
          </p>
        </div>

        {/* A workflow at rest: prompt + image in, generate, out. */}
        <svg
          viewBox="0 0 460 210"
          className="w-full max-w-lg"
          role="presentation"
          focusable="false"
        >
          <GraphNode x={8} y={26} label="Prompt" accent={NODE.prompt} />
          <GraphNode x={8} y={122} label="Image Input" accent={NODE.imageInput} />
          <GraphNode x={176} y={74} label="Generate Image" accent={NODE.generate} w={124} />
          <GraphNode x={340} y={20} label="LLM" accent={NODE.llm} w={92} />
          <GraphNode x={340} y={128} label="Output" accent={NODE.output} w={92} />

          <Edge from={[116, 43]} to={[176, 91]} color={HANDLE.text} />
          <Edge from={[116, 139]} to={[176, 107]} color={HANDLE.image} />
          <Edge from={[300, 91]} to={[340, 37]} color={HANDLE.image} />
          <Edge from={[300, 99]} to={[340, 145]} color={HANDLE.image} />
        </svg>

        <div className="flex flex-wrap gap-2">
          {CAPABILITIES.map(({ label, color }) => (
            <span
              key={label}
              className="flex items-center gap-1.5 rounded-full border border-neutral-700/60 bg-neutral-800/50 px-2.5 py-1 text-[11px] text-neutral-300"
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: color }}
              />
              {label}
            </span>
          ))}
        </div>
      </div>

      <div className="relative px-14 pb-8 text-[11px] text-neutral-600">
        Likelyfad Studio
      </div>
    </div>
  );
}
