'use client';

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6 text-center text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      <div className="max-w-md rounded-2xl border border-red-200 bg-white p-8 shadow-sm dark:border-red-900/60 dark:bg-gray-950">
        <h1 className="text-xl font-semibold">Noter kunde inte laddas</h1>
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
          Ett oväntat fel uppstod under uppstart. Försök igen för att återställa gränssnittet.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
        >
          Försök igen
        </button>
      </div>
    </main>
  );
}
