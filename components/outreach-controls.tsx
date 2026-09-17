"use client";
import { Mail, MessageCircle, CalendarDays } from "lucide-react";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
export function Picker({
  value,
  onChange,
  options,
  label,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  label: string;
  disabled?: boolean;
}) {
  return (
    <Select disabled={disabled} value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="picker">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((x) => (
          <SelectItem key={x} value={x}>
            {x}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export function ChannelMark({ channel }: { channel: string }) {
  return (
    <span className={"channel-mark " + channel.toLowerCase()}>
      {channel === "Email" ? (
        <Mail size={15} />
      ) : channel === "LinkedIn" ? (
        <b>in</b>
      ) : channel === "Pipedrive" ? (
        <b>p</b>
      ) : channel === "Other" ? (
        <CalendarDays size={16} />
      ) : (
        <MessageCircle size={16} />
      )}
    </span>
  );
}
export function download(name: string, text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/csv;charset=utf-8;" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = (await res.json()) as T & { error?: string };
  if (!res.ok)
    throw new Error(result.error || "Request failed. Please try again.");
  return result;
}
