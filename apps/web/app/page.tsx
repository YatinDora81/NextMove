import GeneratePromt from "@/pages/GeneratePromt";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: 'Generate Promt',
  description: 'Generate Promt',
}

export default function LandingPage() {
  return (
    <div className=" ">
      <GeneratePromt />
    </div>
  )
}