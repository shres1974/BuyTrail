"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { buttonPrimary, inputClass } from "./ui";

export function SearchForm({ autoFocus = false, initial = "" }: { autoFocus?: boolean; initial?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(initial);
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const next = new URLSearchParams(params?.toString() ?? "");
        next.set("q", q.trim());
        next.delete("cursor");
        router.push(`/search?${next.toString()}`);
      }}
      className="flex gap-2"
    >
      <label htmlFor="search-q" className="sr-only">
        Search products by name, brand, model or barcode
      </label>
      <input
        id="search-q"
        name="q"
        type="search"
        value={q}
        maxLength={200}
        autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Product name, brand/model (e.g. CP27Q) or barcode"
        className={inputClass}
      />
      <button type="submit" className={buttonPrimary}>
        Search
      </button>
    </form>
  );
}
