import AppliedPage from "@/pages/AppliedPage";
import { GET_GENERATED_MESSAGES } from "@/utils/url";
import { auth } from "@clerk/nextjs/server";
import { GeneratedMessage } from "@/utils/api_types";

export default async function Applied() {
    const { getToken } = await auth();
    const token = await getToken({ template: "frontend_token" })
    const res = await fetch(GET_GENERATED_MESSAGES, {
        method: "GET",
        headers: {
            "Authorization": `Bearer ${token}`
        }
    })
    const data = await res.json()
    
    if(!data.success){
        return <div>Error: {data.message}</div>
    }


    return (
        <AppliedPage  messages={data.data as GeneratedMessage[]} />
    )
}