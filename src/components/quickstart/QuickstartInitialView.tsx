"use client";

interface QuickstartInitialViewProps {
  onNewProject: () => void;
  onSelectTemplates: () => void;
  onSelectVibe: () => void;
  onSelectLoad: () => void;
}

export function QuickstartInitialView({
  onNewProject,
  onSelectTemplates,
  onSelectVibe,
  onSelectLoad,
}: QuickstartInitialViewProps) {
  return (
    <div className="p-8">
      <div className="flex gap-10">
        {/* Left column - Info */}
        <div className="flex-1 flex flex-col">
          <div className="mb-4">
            <div className="flex items-center gap-2">
              <img src="/ls-icon.png" alt="" className="w-7 h-7" />
              <h1 className="text-2xl font-medium text-neutral-100">
                Likelyfad Studio
              </h1>
            </div>
          </div>

          <p className="text-sm text-neutral-400 leading-relaxed mb-6">
            AI-powered creative production workflows. Connect nodes to build pipelines that transform and generate images, video, audio and 3D assets.
          </p>

          <div className="flex flex-col gap-2.5 mt-auto">
            <a
              href="https://x.com/amanxdesign"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              <svg
                className="w-4 h-4"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              X / Twitter
            </a>
            <a
              href="https://www.instagram.com/amanxdesign"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              <svg
                className="w-4 h-4"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
              </svg>
              Instagram
            </a>
          </div>
        </div>

        {/* Right column - Options */}
        <div className="flex-1 flex flex-col gap-2 justify-end">
          <OptionButton
            onClick={onNewProject}
            icon={
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 4.5v15m7.5-7.5h-15"
              />
            }
            title="New project"
            description="Start a new workflow"
          />

          <OptionButton
            onClick={onSelectLoad}
            icon={
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776"
              />
            }
            title="Load workflow"
            description="Open existing file"
          />

          <OptionButton
            onClick={onSelectTemplates}
            icon={
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
              />
            }
            title="Templates"
            description="Pre-built workflows"
          />

          <OptionButton
            onClick={onSelectVibe}
            icon={
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z"
              />
            }
            title="Prompt a workflow"
            description="Get Gemini to build it"
            badge="Beta"
          />

        </div>
      </div>
    </div>
  );
}

function OptionButton({
  onClick,
  icon,
  title,
  description,
  badge,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
  badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="group text-left p-4 rounded-lg border border-neutral-700/50 hover:border-neutral-600 hover:bg-neutral-800/40 transition-all duration-150"
    >
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-md bg-neutral-700/50 flex items-center justify-center flex-shrink-0 group-hover:bg-neutral-700 transition-colors">
          <svg
            className="w-4 h-4 text-neutral-400 group-hover:text-neutral-300 transition-colors"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            {icon}
          </svg>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-neutral-200 group-hover:text-neutral-100 transition-colors">
              {title}
            </h3>
            {badge && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide rounded bg-blue-500/20 text-blue-400">
                {badge}
              </span>
            )}
          </div>
          <p className="text-xs text-neutral-500">{description}</p>
        </div>
      </div>
    </button>
  );
}
