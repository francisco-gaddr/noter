'use client';

export default function Loading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6 text-center text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      <div className="max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-blue-500 dark:border-gray-700 dark:border-t-blue-400" />
        <h1 className="text-xl font-semibold">Laddar Noter…</h1>
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
          Förbereder gränssnitt, lokal data och din session.
        </p>
      </div>
    </main>
  );
}
