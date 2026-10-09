export function Logo({ invert = false }: { invert?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 text-lg font-bold">
      <i className={`grid h-8 w-8 place-items-center rounded-[9px] text-sm not-italic ${invert ? "bg-white text-pri" : "bg-pri text-white"}`}>RH</i>
      RH360
    </div>
  );
}
