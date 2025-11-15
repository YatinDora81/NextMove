import { TemplateProvider } from "@/hooks/useTemplates";
import TemplatesPage from "@/pages/TemplatesPage";
import { Role } from "@/utils/api_types";
import { GET_ALL_ROLES } from "@/utils/url";
import { auth } from "@clerk/nextjs/server";

export default async function Templates() {
    
    const { getToken } = await auth();
    const token = await getToken({ template: "frontend_token" })
  
    const res = await fetch(GET_ALL_ROLES, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`
      }
    })
    const data = await res.json()
  

    return <TemplateProvider>
        <TemplatesPage allRoles={data.data as Role[]} />
    </TemplateProvider>
}