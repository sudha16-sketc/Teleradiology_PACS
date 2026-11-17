"use client";

/**
 * Minimal Code 128-B encoder rendered as SVG. Code 128 is readable by common
 * handheld scanners and prints crisply at any size. The encoded value is a
 * report identifier only (never patient demographics).
 */
const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213",
  "122312", "132212", "221213", "221312", "231212", "112232", "122132",
  "122231", "113222", "123122", "123221", "223211", "221132", "221231",
  "213212", "223112", "312131", "311222", "321122", "321221", "312212",
  "322112", "322211", "212123", "212321", "232121", "111323", "131123",
  "131321", "112313", "132113", "132311", "211313", "231113", "231311",
  "112133", "112331", "132131", "113123", "113321", "133121", "313121",
  "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111",
  "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114",
  "413111", "241112", "134111", "111242", "121142", "121241", "114212",
  "124112", "124211", "411212", "421112", "421211", "212141", "214121",
  "412121", "111143", "111341", "131141", "114113", "114311", "411113",
  "411311", "113141", "114131", "311141", "411131", "211412", "211214",
  "211232", "2331112",
] as const;

const START_B = 104;

export interface BarcodeBar {
  x: number;
  width: number;
}

export function encodeCode128B(value: string): BarcodeBar[] {
  const clean = value.replace(/[^\x20-\x7E]/g, "");
  if (!clean) return [];

  const values: number[] = [];
  let checksum = START_B;
  for (let i = 0; i < clean.length; i += 1) {
    const code = clean.charCodeAt(i) - 32;
    values.push(code);
    checksum += code * (i + 1);
  }
  const check = checksum % 103;
  const sequence = [START_B, ...values, check, 106];

  const bars: BarcodeBar[] = [];
  let x = 10; // quiet zone
  for (const code of sequence) {
    const pattern = CODE128_PATTERNS[code];
    for (let i = 0; i < pattern.length; i += 1) {
      const width = Number(pattern[i]);
      if (i % 2 === 0) bars.push({ x, width });
      x += width;
    }
  }
  return bars;
}

interface BarcodeProps {
  value: string;
  height?: number;
  className?: string;
  showText?: boolean;
}

export function Barcode({
  value,
  height = 48,
  className,
  showText = true,
}: BarcodeProps) {
  const bars = encodeCode128B(value);
  if (bars.length === 0) return null;
  const width = Math.max(...bars.map((b) => b.x + b.width)) + 10;

  return (
    <div className={className}>
      <svg
        role="img"
        aria-label={`Barcode ${value}`}
        viewBox={`0 0 ${width} ${height}`}
        width={180}
        height={height}
        preserveAspectRatio="none"
        style={{ display: "block", maxWidth: "100%" }}
      >
        <rect width={width} height={height} fill="#ffffff" />
        {bars.map((bar, index) => (
          <rect
            key={index}
            x={bar.x}
            y={0}
            width={bar.width}
            height={height}
            fill="#111111"
          />
        ))}
      </svg>
      {showText && (
        <div className="mt-1 break-all text-center font-mono text-[9px] leading-tight text-neutral-700">
          {value}
        </div>
      )}
    </div>
  );
}
