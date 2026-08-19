export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const { message } = await searchParams;

  return (
    <div className="h-screen flex flex-col items-center justify-center gap-4 bg-neutral-950 px-6 text-center">
      <h1 className="text-lg font-semibold text-red-400">Sign-in failed</h1>
      <p className="max-w-md text-sm text-neutral-400 break-words">
        {message || "Something went wrong while signing in."}
      </p>
      <a
        href="/"
        className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-200 transition-colors hover:bg-neutral-800"
      >
        Back to the app
      </a>
    </div>
  );
}
