import GeneratePromt from "@/ui-pages/GeneratePromt";
import { Role, TemplateType } from "@/utils/api_types";
import { GET_ALL_ROLES, GET_PREDEFINED_TEMPLATES } from "@/utils/url";
import { TemplateProvider } from "@/hooks/useTemplates";
import { redirect } from "next/navigation";
import type { Metadata } from 'next';
import { DeviceProvider } from "@/hooks/useDevice";
import { getServerToken } from "@/lib/auth";

export const metadata: Metadata = {
  title: 'Generate Message | NextMoveApp',
  description: 'Generate AI-powered job application messages tailored to each position',
};

export default async function GeneratePage() {
  const token = await getServerToken()

  if (!token) {
    redirect("/?popup=login&redirect_url=/generate")
  }

  console.log('[Generate Page] Token exists:', !!token)
  console.log('[Generate Page] Fetching from:', GET_ALL_ROLES)
  
  const res = await fetch(GET_ALL_ROLES, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`
    },
    cache: 'no-store'
  })

  if (!res.ok) {
    const errorBody = await res.text()
    console.error('Failed to fetch roles:', res.status, res.statusText, errorBody);
    throw new Error(`Failed to fetch roles: ${res.status} ${res.statusText} - ${errorBody}`);
  }

  const data = await res.json()

  const predefinedTemplates = await fetch(GET_PREDEFINED_TEMPLATES, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`
    }
  })

  if (!predefinedTemplates.ok) {
    console.error('Failed to fetch predefined templates:', predefinedTemplates.status, predefinedTemplates.statusText);
    throw new Error(`Failed to fetch predefined templates: ${predefinedTemplates.status} ${predefinedTemplates.statusText}`);
  }

  const predefinedTemplatesData = await predefinedTemplates.json()

  return (
    <div>
      <DeviceProvider>
        <TemplateProvider>
          <GeneratePromt allRoles={data.data as Role[]} predefinedTemplates={predefinedTemplatesData.data as TemplateType[] || []} />
        </TemplateProvider>
      </DeviceProvider>
    </div>
  )
} 

export const dynamic = 'force-dynamic';
