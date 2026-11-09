/** Reusable, labelled and keyboard-accessible control used by PDF tools. */
export default function RangeSlider({id,label,min,max,step=1,value,unit="",disabled=false,onChange}:{
  id:string;label:string;min:number;max:number;step?:number;value:number;
  unit?:string;disabled?:boolean;onChange:(value:number)=>void;
}) {
  return <>
    <div className="orbit-range-label">
      <label htmlFor={id}>{label}</label>
      <output htmlFor={id} aria-live="off">{value}{unit}</output>
    </div>
    <input id={id} type="range" min={min} max={max} step={step}
      value={value} disabled={disabled}
      aria-valuetext={value+unit}
      onChange={event=>onChange(Number(event.target.value))}/>
  </>;
}
