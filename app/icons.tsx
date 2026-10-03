// Small stroke icons for the home page illustration.
const PATHS = {
  phone: ["M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"],
  mail: ["M4 6h16v12H4z", "M4 7l8 6 8-6"],
  chat: ["M5 5h14v10H10l-5 4z"],
  receipt: ["M7 3h10v18l-2.5-1.5L12 21l-2.5-1.5L7 21z", "M10 8h4M10 12h4"],
  globe: ["M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z", "M3 12h18", "M12 3c3 3.2 3 14.8 0 18c-3-3.2-3-14.8 0-18z"],
  database: ["M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3z", "M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6", "M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"],
  shield: ["M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z", "M9 12l2 2 4-4"],
  bolt: ["M13 3L5 14h6l-1 7 8-11h-6z"],
  user: ["M12 12a4 4 0 1 0 0-8a4 4 0 0 0 0 8z", "M4 21a8 8 0 0 1 16 0"],
  check: ["M5 12l5 5 9-10"],
  key: ["M8 19a4 4 0 1 0 0-8a4 4 0 0 0 0 8z", "M11 12l9-9M16 7l3 3"],
  radio: ["M12 14a2 2 0 1 0 0-4a2 2 0 0 0 0 4z", "M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4", "M5 19a10 10 0 0 1 0-14M19 5a10 10 0 0 1 0 14"],
  code: ["M9 8l-4 4 4 4M15 8l4 4-4 4"],
  building: ["M5 21V5h9v16", "M14 9h5v12", "M3 21h18", "M8 9h3M8 13h3M8 17h3"],
  folder: ["M3 7h6l2 2h10v10H3z"],
  arrow: ["M5 12h14M13 6l6 6-6 6"],
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "size-5" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
