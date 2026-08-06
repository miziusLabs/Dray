import type { SessionIndexItem } from "../types/events"

export default function Sidebar({items, onSelect, onNewSession} : {items: SessionIndexItem[], onSelect: (sessionId: string) => Promise<void>, onNewSession: () => void}) {
    return <div className="border-r max-w-50 p-4">
    <div className="flex flex-row items-center justify-between">
    <p>Sessions</p>
    <button onClick={onNewSession}>New</button>
    </div>
    <div className="flex flex-col gap-2" >
    {items.map((item) =>
        <div key={item.sessionId} className="flex flex-col gap-1 p-2 border-b cursor-pointer" onClick={() => { void onSelect(item.sessionId); }}>
        <p>{item.title}</p>
        <p>{item.projectPath}</p>
        </div>
    )}
    </div>
    </div>
}