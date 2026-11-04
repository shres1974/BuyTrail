"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-lg py-12 text-center">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="mt-2 text-muted">The page couldn&apos;t load. Your saved data is unaffected.</p>
      <button type="button" onClick={reset} className="mt-4 rounded-md bg-teal px-4 py-2 text-sm font-semibold text-white">
        Try again
      </button>
    </div>
  );
}
