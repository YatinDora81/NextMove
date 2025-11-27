import GeneratePromt from "@/ui-pages/GeneratePromt";
import { Role, TemplateType } from "@/utils/api_types";
import { GET_ALL_ROLES, GET_PREDEFINED_TEMPLATES } from "@/utils/url";
import { auth } from "@clerk/nextjs/server";
import { TemplateProvider } from "@/hooks/useTemplates";
import { redirect } from "next/navigation";
import type { Metadata } from 'next';
import { DeviceProvider } from "@/hooks/useDevice";

export const metadata: Metadata = {
  title: 'Generate Message | NextMoveApp',
  description: 'Generate AI-powered job application messages tailored to each position',
};

export default async function LandingPage() {
  const { getToken } = await auth();
  const token = await getToken({ template: "frontend_token" })

  if (!token) {
    redirect("/")
  }

  const res = await fetch(GET_ALL_ROLES, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`
    }
  })

  if (!res.ok) {
    console.error('Failed to fetch roles:', res.status, res.statusText);
    throw new Error(`Failed to fetch roles: ${res.status} ${res.statusText}`);
  }

  const data = await res.json()

  console.log('data -> ', data);

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

  console.log('predefinedTemplatesData -> ', predefinedTemplatesData);

  console.log('token -> ', token);

  return (
    <div className=" ">
      <DeviceProvider>
        <TemplateProvider>
          <GeneratePromt allRoles={data.data as Role[]} predefinedTemplates={predefinedTemplatesData.data as TemplateType[] || []} />
        </TemplateProvider>
      </DeviceProvider>
    </div>
  )
} 

export const dynamic = 'force-dynamic';

