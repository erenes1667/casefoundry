import type { PhoneFeature, PhoneRecord } from "../types";

interface PhoneDiagramProps {
  phone: PhoneRecord;
  view: "screen" | "rear";
  selectedFeatureId?: string;
  onSelectFeature?: (feature: PhoneFeature) => void;
}

export function PhoneDiagram({
  phone,
  view,
  selectedFeatureId,
  onSelectFeature,
}: PhoneDiagramProps) {
  const width = phone.dimensions.width;
  const length = phone.dimensions.length;
  const x = (value: number) =>
    view === "rear" ? 150 - ((value + width / 2) / width) * 120 : 30 + ((value + width / 2) / width) * 120;
  const y = (value: number) => 25 + ((length / 2 - value) / length) * 250;
  const bodyFeatures = phone.features.filter((feature) =>
    view === "rear"
      ? feature.side === "back"
      : feature.side !== "back" && feature.side !== "screen",
  );

  return (
    <div className="phone-diagram-wrap">
      <svg className="phone-diagram" viewBox="0 0 180 300" role="img" aria-label={`${view} coordinate view`}>
        <defs>
          <linearGradient id="phone-body" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#263129" />
            <stop offset="1" stopColor="#151a16" />
          </linearGradient>
        </defs>
        <rect x="27" y="22" width="126" height="256" rx="18" fill="url(#phone-body)" stroke="#5d715f" strokeWidth="1.4" />
        <rect x="32" y="27" width="116" height="246" rx="14" fill="none" stroke="#2f3a31" />
        {view === "screen" && <rect x="75" y="29" width="30" height="3" rx="1.5" fill="#4d5b50" />}
        {bodyFeatures.map((feature) => {
          const active = feature.id === selectedFeatureId;
          if (feature.side === "back") {
            const cx = x(feature.center.x);
            const cy = y(feature.center.y);
            const sx = Math.max(4, (feature.size.x / width) * 120);
            const sy = Math.max(4, (feature.size.y / length) * 250);
            return feature.shape === "circle" ? (
              <circle
                key={feature.id}
                cx={cx}
                cy={cy}
                r={sx / 2}
                className={active ? "feature active" : "feature"}
                onClick={() => onSelectFeature?.(feature)}
              />
            ) : (
              <rect
                key={feature.id}
                x={cx - sx / 2}
                y={cy - sy / 2}
                width={sx}
                height={sy}
                rx="4"
                className={active ? "feature active" : "feature"}
                onClick={() => onSelectFeature?.(feature)}
              />
            );
          }
          const sideX = feature.side === "screenRight" ? 154 : feature.side === "screenLeft" ? 26 : x(feature.center.x);
          const sideY = feature.side === "top" ? 21 : feature.side === "bottom" ? 279 : y(feature.center.y);
          const horizontal = feature.side === "top" || feature.side === "bottom";
          const size = horizontal
            ? Math.max(5, (feature.size.x / width) * 120)
            : Math.max(5, (feature.size.y / length) * 250);
          return (
            <rect
              key={feature.id}
              x={horizontal ? sideX - size / 2 : sideX - 2.5}
              y={horizontal ? sideY - 2.5 : sideY - size / 2}
              width={horizontal ? size : 5}
              height={horizontal ? 5 : size}
              rx="2.5"
              className={active ? "feature active" : "feature"}
              onClick={() => onSelectFeature?.(feature)}
            />
          );
        })}
        <g className="axis-markers">
          <path d="M90 290 L90 282 M90 290 L86 286 M90 290 L94 286" />
          <text x="96" y="293">−Y bottom</text>
          <path d="M164 150 L174 150 M174 150 L170 146 M174 150 L170 154" />
          <text x="126" y="143">{view === "rear" ? "visual left" : "+X right"}</text>
        </g>
      </svg>
      <div className="diagram-caption">
        <strong>{view === "rear" ? "Rear visual view" : "Canonical screen view"}</strong>
        <span>
          {view === "rear"
            ? "Rear view mirrors X visually. Stored coordinates do not change."
            : "+X is the phone’s physical screen-right side."}
        </span>
      </div>
    </div>
  );
}
