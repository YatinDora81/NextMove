"use client"
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { useUser } from "@/hooks/useAuth";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { usePopUp } from "@/hooks/usePopUp";

interface GetStartedButtonProps {
    variant?: "default" | "outline" | "secondary";
    className?: string;
    size?: "default" | "sm" | "lg" | "icon";
    children?: React.ReactNode;
}

export default function GetStartedButton({ 
    variant = "default", 
    className, 
    size = "default",
    children = "Get Started Free"
}: GetStartedButtonProps) {
    const { isSignedIn } = useUser();
    const router = useRouter();
    const { setPopup } = usePopUp();

    const handleClick = () => {
        if (isSignedIn) {
            router.push("/generate");
        } else {
            setPopup("login");
        }
    };

    const buttonContent = (
        <>
            {children}
            {typeof children === "string" && children !== "Learn More" && <ArrowRight className="ml-2" />}
        </>
    );

    return (
        <Button
            variant={variant}
            size={size}
            className={cn(className)}
            onClick={handleClick}
        >
            {buttonContent}
        </Button>
    );
}
