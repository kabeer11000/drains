import { useEffect, useState } from "react";
import { useStore } from "@nanostores/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { startDrainSync } from "@/services/sync";
import { $sync, syncStateOf, type SyncState } from "@/stores/sync";

type Shown = "connecting" | "syncing" | "synced" | "offline" | "no-access" | "error";

const META: Record<Shown, { dot: string; label: string; description: string }> = {
	connecting: { dot: "bg-yellow-400", label: "Connecting", description: "Connecting to the sync server. You can keep writing." },
	syncing: { dot: "bg-green-400 animate-pulse", label: "Syncing", description: "Sending and receiving changes." },
	synced: { dot: "bg-green-400", label: "Synced", description: "Everything on this device is saved to the server." },
	offline: {
		dot: "bg-neutral-400 dark:bg-neutral-500",
		label: "Offline",
		description: "Can't reach the server. Your changes are saved on this device and will sync when you're back online.",
	},
	"no-access": {
		dot: "bg-red-500",
		label: "Not syncing",
		description: "The server refused this drain: you aren't a member, or it doesn't exist. Changes here stay on this device only.",
	},
	error: {
		dot: "bg-red-500",
		label: "Sync error",
		description: "The server returned an error. Changes are saved on this device and sync will keep retrying.",
	},
};

export function shownSyncState(state: SyncState, timedOut: boolean): Shown {
	if (state.status === "error") return state.problem === "no-access" ? "no-access" : "error";
	if (state.status === "connecting" && timedOut) return "offline";
	return state.status;
}

export default function SyncIndicator({ dbName }: { dbName: string }) {
	const state = useStore($sync)[dbName] ?? syncStateOf(dbName);
	const [timedOut, setTimedOut] = useState(false);

	useEffect(() => {
		startDrainSync(dbName);
	}, [dbName]);

	// Still "connecting" after 5s almost always means no network.
	useEffect(() => {
		if (state.status !== "connecting") return;
		const timeout = setTimeout(() => setTimedOut(true), 5000);
		return () => clearTimeout(timeout);
	}, [state.status]);

	const shown = shownSyncState(state, timedOut);
	const meta = META[shown];
	const bad = shown === "no-access" || shown === "error" || state.rejected > 0;

	return (
		<Popover>
			<PopoverTrigger
				render={
					<button
						className={`absolute top-4 right-6 z-50 flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs backdrop-blur-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 ${
							bad
								? "border-red-500/40 bg-red-500/10 text-red-600 hover:bg-red-500/15 dark:text-red-400"
								: "bg-background/80 text-muted-foreground hover:bg-background"
						}`}
					/>
				}
			>
				<span className={`h-2 w-2 rounded-full ${meta.dot}`} />
				<span>{state.rejected > 0 && shown !== "no-access" && shown !== "error" ? "Changes rejected" : meta.label}</span>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-72 text-sm">
				<div className="flex items-center gap-2 font-medium">
					<span className={`h-2 w-2 rounded-full ${meta.dot}`} />
					<span>{meta.label}</span>
				</div>
				<p className="mt-1.5 text-xs text-muted-foreground">{meta.description}</p>
				{state.rejected > 0 && (
					<p className="mt-2 text-xs text-red-600 dark:text-red-400">
						{state.rejected} {state.rejected === 1 ? "change was" : "changes were"} rejected by the server
						{state.lastRejectReason ? ` (${state.lastRejectReason})` : ""} and won't sync.
					</p>
				)}
				<p className="mt-2 text-xs text-muted-foreground">Last update: {new Date(state.updatedAt).toLocaleTimeString()}</p>
			</PopoverContent>
		</Popover>
	);
}
