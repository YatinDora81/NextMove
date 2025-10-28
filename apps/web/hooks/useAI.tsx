import { createContext, useContext, useState } from "react"

type AIContextType = {

}

const AIContext = createContext<AIContextType | null>(null);

export const AIProvider = ({ children }: { children: React.ReactNode }) => {

    const [rooms, setRooms] = useState<any[]>([]);


    return (
        <AIContext.Provider value={{}}>
            {children}
        </AIContext.Provider>
    )
}

export const useAI = () => {
    const context = useContext(AIContext);
    if (!context) {
        throw new Error("useAI must be used within a AIProvider");
    }
    return context;
}