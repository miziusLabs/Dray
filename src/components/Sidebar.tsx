import type { SessionIndexItem } from "../hooks/useSessions"

export default function Sidebar({items, onSelect} : {items: SessionIndexItem[], onSelect: (indexItem: SessionIndexItem) => Promise<void>}) {
    return <div className="border-r max-w-50 p-4">
    <p>Sessions</p>
    <div className="flex flex-col gap-2" >
    {items.map((item) => 
        <div key={item.sessionId} className="flex flex-col gap-1 p-2 border-b cursor-pointer" onClick={() => { void onSelect(item); }}>
        <p>{item.title}</p>
        <p>{item.projectPath}</p>
        </div>
    )}
    </div>
    </div>
}