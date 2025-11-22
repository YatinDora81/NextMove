import GeneratePromt from "@/pages/GeneratePromt";
import { Role } from "@/utils/api_types";
import { GET_ALL_ROLES } from "@/utils/url";
import { auth } from "@clerk/nextjs/server";
import { TemplateProvider } from "@/hooks/useTemplates";
import { redirect } from "next/navigation";

export default async function LandingPage() {
  const { getToken } = await auth();
  const token = await getToken({ template: "frontend_token" })

  if(!token){
    redirect("/")
  }

  const res = await fetch(GET_ALL_ROLES, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`
    }
  })
  const data = await res.json()

  return (
    <div className=" ">
      <TemplateProvider>
        <GeneratePromt allRoles={ data.data as Role[]} />
      </TemplateProvider>
    </div>
  )
}