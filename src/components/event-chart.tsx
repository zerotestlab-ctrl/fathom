"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function EventChart({ data }: { data: { label: string; count: number }[] }) {
  if (!data.length) {
    return <p className="text-sm text-muted">No events in this window yet, so the chart is empty.</p>;
  }
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <XAxis dataKey="label" tick={{ fill: "#a7ad9c", fontSize: 11 }} interval="preserveStartEnd" />
          <YAxis allowDecimals={false} width={32} tick={{ fill: "#a7ad9c", fontSize: 11 }} />
          <Tooltip
            cursor={{ fill: "rgba(223,245,106,0.08)" }}
            contentStyle={{ background: "#171d15", border: "1px solid #2c3428", color: "#efe8d6" }}
          />
          <Bar dataKey="count" fill="#dff56a" radius={0} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
