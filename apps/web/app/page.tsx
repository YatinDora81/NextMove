import type { Metadata } from "next";
import { CheckCircle2, Sparkles, MessageSquare, BarChart3, Zap, Users, RefreshCw, GraduationCap, Briefcase, Star, Github, Linkedin, Twitter } from "lucide-react";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import GetStartedButton from "@/components/GetStartedButton";
import Image from "next/image";
import DarkImage from '../public/dark.gif';
import LightImage from '../public/light.gif';

export const metadata: Metadata = {
    title: "NextMoveApp | AI Job Application Assistant",
    description: "NextMoveApp helps job seekers craft personalized applications, track progress, and collaborate with AI to land their next role faster.",
};

export default function LandingPage() {
    const imageCards: { title: string, desc: string }[] = [
        {
            title: '95%',
            desc: 'User Satisfaction'
        },
        {
            title: '2 min',
            desc: 'Average Setup Time'
        },
        {
            title: '10x',
            desc: 'Faster Applications'
        },
        {
            title: '24/7',
            desc: 'AI Availability'
        }
    ]

    const featuresCard: { icon: LucideIcon, title: string, description: string }[] = [
        {
            icon: Sparkles,
            title: "AI-Powered Messages",
            description: "Generate personalized cover letters and messages tailored to each job posting in seconds."
        },
        {
            icon: MessageSquare,
            title: "Smart Templates",
            description: "Pre-built templates optimized for different industries and job types."
        },
        {
            icon: BarChart3,
            title: "Application Tracking",
            description: "Keep track of all your applications in one place with status updates."
        },
        {
            icon: Zap,
            title: "Instant Generation",
            description: "Create professional applications 10x faster than traditional methods.",
        },
    ]

    const appSteps: { step: number, icon: LucideIcon, title: string, description: string }[] = [
        {
            step: 1,
            icon: Users,
            title: "Create Your Profile",
            description: "Add your experience, skills, and career goals to help our AI understand your background.",
        },
        {
            step: 2,
            icon: MessageSquare,
            title: "Paste Job Details",
            description: "Simply paste the job description and let our AI analyze the requirements.",
        },
        {
            step: 3,
            icon: Sparkles,
            title: "Generate Message",
            description: "AI creates a personalized, professional message highlighting your relevant skills.",
        },
        {
            step: 4,
            icon: BarChart3,
            title: "Track & Apply",
            description: "Send your application and track its status all in one place.",
        },
    ];

    const useCases = [
        {
            icon: Users,
            title: "Active Job Seekers",
            description: "Apply to multiple positions efficiently while maintaining quality and personalization in every application.",
        },
        {
            icon: RefreshCw,
            title: "Career Changers",
            description: "Navigate career transitions with professional messaging that highlights transferable skills.",
        },
        {
            icon: GraduationCap,
            title: "Recent Graduates",
            description: "Enter the job market with confidence using professionally crafted messages that showcase your potential.",
        },
        {
            icon: Briefcase,
            title: "Professionals",
            description: "Manage multiple opportunities while advancing your career with consistent, polished communication.",
        },
    ];

    const testimonials = [
        {
            name: "Sarah Johnson",
            role: "Software Engineer",
            content: "NextMoveApp helped me land my dream job. The AI-generated messages were professional and saved me hours of writing time.",
            rating: 5,
        },
        {
            name: "Michael Chen",
            role: "Product Manager",
            content: "Managing multiple applications was overwhelming until I found NextMoveApp. The tracking feature alone is worth it.",
            rating: 5,
        },
        {
            name: "Emily Rodriguez",
            role: "Marketing Specialist",
            content: "As a career changer, I needed help crafting the right message. This tool gave me the confidence I needed.",
            rating: 4,
        },
    ];


    return (
        <div className='w-full h-fit min-h-screen flex flex-col justify-center gap-6'>

            {/* hero section */}
            <div className=" relative flex flex-col justify-evenly items-center h-[45rem] sm:h-[50rem] md:h-[42rem] px-4">

                <div
                    className={cn(
                        "absolute inset-0 z-0",
                        "[background-size:40px_40px]",
                        "[background-image:linear-gradient(to_right,#e4e4e7_1px,transparent_1px),linear-gradient(to_bottom,#e4e4e7_1px,transparent_1px)]",
                        "dark:[background-image:linear-gradient(to_right,#262626_1px,transparent_1px),linear-gradient(to_bottom,#262626_1px,transparent_1px)]"
                    )}
                />
                <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center bg-background [mask-image:radial-gradient(ellipse_at_center,transparent_10%,black)]"></div>

                <div className=" z-[11] flex flex-col gap-4 sm:gap-6 md:gap-8 items-center justify-evenly w-full">
                    {/* badge */}
                    <div className="flex gap-2 bg-gray-200/50 dark:bg-zinc-700/50 mt-12 sm:mt-16 md:mt-20 justify-center items-center border-2 border-gray-200 dark:border-zinc-700/10 rounded-3xl p-1.5 sm:p-2 px-3 sm:px-4">
                        <Sparkles className="w-3 h-3 sm:w-4 sm:h-4"></Sparkles>
                        <div className=" font-[500] text-xs sm:text-sm">AI-Powered Job Application Platform</div>
                    </div>

                    <div className=" flex flex-col items-center gap-6 sm:gap-8 md:gap-12 px-4">

                        <div className=" flex flex-col items-center gap-2 sm:gap-4">
                            <div className=" text-3xl sm:text-5xl md:text-7xl font-bold poppins-bold text-center">
                                Land Your Dream Job
                            </div>
                            <div className=" text-3xl sm:text-5xl md:text-7xl font-bold poppins-bold text-center" style={{
                                // maskImage: 'linear-gradient(to right, black 90%, transparent 100%)',
                                // WebkitMaskImage: 'linear-gradient(to right, black 90%, transparent 100%)'
                            }}>
                                10x Faster
                            </div>
                        </div>

                        <div className=" flex flex-col items-center gap-1 sm:gap-2">
                            <div className=" dark:text-gray-300 text-gray-500 poppins-medium text-base sm:text-xl md:text-2xl text-center px-4" >AI-powered messaging that gets you noticed by recruiters.</div>
                            <div className=" dark:text-gray-300 text-gray-500 poppins-medium text-base sm:text-xl md:text-2xl text-center px-4" >Create professional applications in seconds.</div>
                        </div>

                        <div className=" flex flex-wrap justify-center items-center gap-2 sm:gap-[1.5rem] px-4">
                            {
                                ["Instant AI Generation",
                                    "Smart Templates",
                                    "Application Tracking"].map((item, index) => (
                                        <div className="border-[1px] p-1.5 sm:p-2 px-2 sm:px-3 rounded-3xl dark:bg-zinc-950/60 bg-white dark:border-gray-200/30 border-black/40 flex items-center gap-1.5 sm:gap-2" key={index}>
                                            <CheckCircle2 className="w-3 h-3 sm:w-4 sm:h-4" />
                                            <div className=" poppins-medium text-xs sm:text-sm whitespace-nowrap" >{item}</div>
                                        </div>
                                    ))
                            }
                        </div>


                        <div className=" flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 w-full px-4">
                            <GetStartedButton className=" py-2 px-4 w-full sm:w-auto">Get Started Free</GetStartedButton>
                            <GetStartedButton variant='outline' className=" border border-gray-400/50 w-full sm:w-auto">Learn More</GetStartedButton>
                        </div>

                        {/* <div className=" text-gray-500 poppins-medium text-sm">No credit card required • Free forever</div> */}

                    </div>


                </div>

            </div>


            <div className="w-full md:w-[74rem] mx-auto h-fit flex flex-col justify-center gap-6 sm:gap-8 md:gap-10 px-4 sm:px-6">
                <div className=" relative w-full h-[20rem] sm:h-[30rem] md:h-[40rem] min-h-[20rem] sm:min-h-[30rem] md:min-h-[40rem] border border-zinc-700/30 dark:border-zinc-800/30 shadow-2xl shadow-zinc-500/20 rounded-2xl">
                    <div className=" absolute top-0 left-0 w-full h-[7%] rounded-t-2xl dark:bg-zinc-900 bg-zinc-100 flex justify-start items-center pl-4 sm:pl-6 gap-2 sm:gap-3">
                        <div className=" bg-red-600 w-2 h-2 sm:w-3 sm:h-3 rounded-full "></div>
                        <div className=" bg-yellow-500 w-2 h-2 sm:w-3 sm:h-3 rounded-full "></div>
                        <div className=" bg-green-600 w-2 h-2 sm:w-3 sm:h-3 rounded-full "></div>
                    </div>


                    {/* Actual image */}
                    <div className=" rounded-b-2xl h-[93%] w-full absolute left-0 bottom-0">
                            <Image src={DarkImage} className="rounded-b-2xl w-full h-full object-cover hidden dark:block" alt="Dark Image"></Image>
                            <Image src={LightImage} className=" rounded-b-2xl w-full h-full object-cover block dark:hidden" alt="Light Image"></Image>
                    </div>

                </div>

                <div className=" grid grid-cols-2 sm:grid-cols-4 items-center justify-center gap-3 sm:gap-4 md:gap-5 w-full">
                    {
                        imageCards.map((item, index) => (
                            <div key={index} className=" w-full rounded-2xl flex flex-col items-center justify-center gap-1 sm:gap-2 dark:bg-zinc-900/60 border dark:border-gray-200/30 border-zinc-700/30 px-3 sm:px-6 md:px-8 py-4 sm:py-6">
                                <div className=" text-2xl sm:text-3xl md:text-4xl font-bold">{item.title}</div>
                                <div className=" text-xs sm:text-sm text-black/80 dark:text-zinc-200/50 text-center">{item.desc}</div>
                            </div>
                        ))
                    }
                </div>

            </div>


            {/* Featues */}
            <div className="w-full md:w-[70rem] gap-8 sm:gap-10 md:gap-12 mx-auto h-fit min-h-[35rem] mt-[6rem] sm:mt-[4rem] md:mt-[5rem] flex flex-col justify-center items-start px-4 sm:px-6" >
                <div className="flex flex-col items-center w-full justify-center gap-3 sm:gap-4 md:gap-5">
                    <div className=" w-full text-center text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold px-4">Everything You Need to Land Your Next Role</div>
                    <div className=" dark:text-zinc-200/50 poppins-medium text-base sm:text-lg md:text-xl text-center px-4">Powerful features designed to streamline your job search process</div>
                </div>

                <div className=" grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 items-center justify-center mx-auto gap-4 sm:gap-5 w-full">
                    {
                        featuresCard.map((item, index) => (
                            <div key={index} className=" w-full rounded-2xl flex flex-col items-center justify-between gap-3 dark:bg-[#171717] border dark:border-gray-700/30 min-h-[10rem] sm:h-[15rem] border-zinc-700/30 px-4 sm:px-6 md:px-8 py-4 sm:py-6">
                                <div className=" text-4xl font-bold bg-black/10 dark:bg-zinc-700/50 rounded-lg p-3">
                                    <item.icon className="w-5 h-5 " />
                                </div>
                                <div className=" text-center text-lg sm:text-xl font-bold">{item.title}</div>
                                <div className=" text-xs sm:text-sm text-center dark:text-zinc-100/70">{item.description}</div>
                            </div>
                        ))
                    }
                </div>

            </div>


            {/* How It Works */}
            <div className="w-full md:w-[70rem] gap-8 sm:gap-10 md:gap-12 mx-auto h-fit min-h-[45rem] flex flex-col justify-center items-start mt-[4rem] sm:mt-0 px-4 sm:px-6" >
                <div className="flex flex-col items-center w-full justify-center gap-3 sm:gap-4 md:gap-5">
                    <div className=" w-full text-center text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold px-4">How It Works</div>
                    <div className=" dark:text-zinc-200/50 poppins-medium text-base sm:text-lg md:text-xl text-center px-4">Get started in minutes and land your dream job faster</div>
                </div>

                <div className=" grid grid-cols-1 sm:grid-cols-2 items-center justify-center mx-auto gap-4 sm:gap-5 w-full">
                    {
                        appSteps.map((item, index) => (
                            <div key={index} className=" relative w-full rounded-2xl flex flex-col items-start justify-between gap-3 dark:bg-[#171717] border dark:border-gray-700/30 min-h-[9rem] sm:h-[12rem] border-zinc-700/30 px-4 sm:px-6 md:px-8 py-4 sm:py-6">
                                <div className="  text-4xl font-bold bg-black/10 dark:bg-zinc-700/50 rounded-lg p-3">
                                    <item.icon className="w-5 h-5 " />
                                </div>
                                <div className=" text-xs sm:text-sm w-6 h-6 sm:w-7 sm:h-7 flex justify-center items-center bg-black/10 dark:bg-zinc-700/50 rounded-full absolute right-4 sm:right-6 top-3">
                                    <div className=" p-1">{item.step}</div>
                                </div>
                                <div className=" flex gap-2 flex-col">
                                    <div className=" text-lg sm:text-xl font-bold">{item.title}</div>
                                    <div className=" text-xs sm:text-sm dark:text-zinc-100/70">{item.description}</div>
                                </div>
                            </div>
                        ))
                    }
                </div>

            </div>

            <div className="w-full md:w-[70rem] gap-8 sm:gap-10 md:gap-12 mx-auto h-fit min-h-[45rem] flex flex-col justify-center items-start px-4 sm:px-6 mt-[4rem] sm:mt-0" >
                <div className="flex flex-col items-center w-full justify-center gap-3 sm:gap-4 md:gap-5">
                    <div className=" w-full text-center text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold px-4">Built For Every Job Seeker</div>
                    <div className=" dark:text-zinc-200/50 poppins-medium text-base sm:text-lg md:text-xl w-full sm:w-[90%] md:w-[60%] mx-auto text-center px-4">Whether you're starting out or advancing your career, NextMoveApp adapts to your needs</div>
                </div>

                <div className=" grid grid-cols-1 sm:grid-cols-2 items-center justify-center mx-auto gap-4 sm:gap-5 w-full">
                    {
                        useCases.map((item, index) => (
                            <div key={index} className=" relative w-full rounded-2xl flex items-start gap-3 dark:bg-[#171717] border dark:border-gray-700/30 min-h-[8rem] border-zinc-700/30 px-4 sm:px-6 py-5 sm:py-7">
                                <div className="  text-4xl font-bold bg-black/10 dark:bg-zinc-700/50 rounded-lg p-3 flex-shrink-0">
                                    <item.icon className="w-5 h-5 " />
                                </div>

                                <div className=" flex gap-2 flex-col">
                                    <div className=" text-lg sm:text-xl font-bold">{item.title}</div>
                                    <div className=" text-xs sm:text-sm dark:text-zinc-100/70">{item.description}</div>
                                </div>
                            </div>
                        ))
                    }
                </div>

            </div>

            <div className=" dark:bg-zinc-900/60 gap-8 sm:gap-10 md:gap-12 mx-auto h-fit min-h-[48rem] sm:-mt-[1rem] w-full mt-[4rem] " >
                <div className=" w-full md:w-[70rem] flex flex-col justify-center gap-8 sm:gap-10 md:gap-12 items-center h-fit min-h-[48rem] mx-auto px-4 sm:px-6">
                    <div className="flex flex-col items-center w-full justify-center gap-3 sm:gap-4 md:gap-5">
                        <div className=" w-full text-center text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold px-4">Loved by Job Seekers</div>
                        <div className=" dark:text-zinc-200/50 poppins-medium text-base sm:text-lg md:text-xl text-center px-4">See what our users have to say about their experience</div>
                    </div>

                    <div className=" grid grid-cols-1 md:grid-cols-3 items-center justify-center mx-auto gap-4 sm:gap-5 w-full">
                        {testimonials.map((testimonial, index) => (
                            <Card
                                key={index}
                                className="p-6 sm:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.12)] min-h-[15rem] md:min-h-[21.5rem] space-y-4 border-border bg-card w-full"
                            >
                                <div className="flex gap-1">
                                    {[...Array(testimonial.rating)].map((_, i) => (
                                        <Star key={i} className="w-4 h-4 sm:w-5 sm:h-5 fill-yellow-500 text-yellow-500" />
                                    ))}
                                </div>
                                <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
                                    &ldquo;{testimonial.content}&rdquo;
                                </p>
                                <div className="pt-4 border-t border-border">
                                    <div className="font-semibold text-sm sm:text-base">{testimonial.name}</div>
                                    <div className="text-xs sm:text-sm text-muted-foreground">{testimonial.role}</div>
                                </div>
                            </Card>
                        ))}
                    </div>

                </div>
            </div>

            {/* CTA */}
            <section className="py-12 sm:py-16 md:py-0">
                <div className="container mx-auto px-4">
                    <div className="max-w-4xl mx-auto">
                        <div className="relative overflow-hidden rounded-3xl bg-primary text-primary-foreground p-6 sm:p-8 md:p-12 lg:p-16">
                            <div className="absolute inset-0 opacity-10">
                                <div className="absolute top-0 right-0 w-64 h-64 bg-primary-foreground rounded-full blur-3xl" />
                                <div className="absolute bottom-0 left-0 w-96 h-96 bg-primary-foreground rounded-full blur-3xl" />
                            </div>
                            <div className="relative text-center space-y-6 sm:space-y-8">
                                <div className="space-y-3 sm:space-y-4">
                                    <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold px-2">
                                        Ready to Transform Your Job Search?
                                    </h2>
                                    <p className="text-base sm:text-lg md:text-xl opacity-90 max-w-2xl mx-auto px-2">
                                        Join thousands of job seekers who are landing their dream roles with AI-powered applications
                                    </p>
                                </div>
                                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                                    <GetStartedButton className="w-full sm:w-auto" />
                                </div>
                                <p className="text-xs sm:text-sm opacity-75">
                                    No credit card required • Start in minutes
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* footer */}
            <footer className="border-t border-border bg-muted/30">
                <div className="container mx-auto px-4 py-12 md:py-16">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
                        <div className="col-span-2 md:col-span-1">
                            <h3 className="font-bold text-xl mb-4">NextMoveApp</h3>
                            <p className="text-sm text-muted-foreground">
                                AI-powered job application platform helping thousands land their dream roles.
                            </p>
                        </div>
                        <div>
                            <h4 className="font-semibold mb-4">Product</h4>
                            <ul className="space-y-2 text-sm text-muted-foreground">
                                <li><a href="#features" className="hover:text-primary">Features</a></li>
                                <li><a href="#how-it-works" className="hover:text-primary">How It Works</a></li>
                            </ul>
                        </div>
                        <div>
                            <h4 className="font-semibold mb-4">Company</h4>
                            <ul className="space-y-2 text-sm text-muted-foreground">
                                <li><a href="#about" className="hover:text-primary transition-colors">About</a></li>
                                <li><a href="#blog" className="hover:text-primary transition-colors">Blog</a></li>
                                <li><a href="#careers" className="hover:text-primary transition-colors">Careers</a></li>
                            </ul>
                        </div>
                        <div>
                            <h4 className="font-semibold mb-4">Legal</h4>
                            <ul className="space-y-2 text-sm text-muted-foreground">
                                <li><a href="#privacy" className="hover:text-primary transition-colors">Privacy</a></li>
                                <li><a href="#terms" className="hover:text-primary transition-colors">Terms</a></li>
                                <li><a href="#security" className="hover:text-primary transition-colors">Security</a></li>
                            </ul>
                        </div>
                    </div>
                    <div className="pt-8 border-t border-border flex flex-col md:flex-row justify-between items-center gap-4">
                        <p className="text-sm text-muted-foreground">
                            © {new Date().getFullYear()} NextMoveApp. All rights reserved.
                        </p>
                        <div className="flex gap-4">
                            <a target="_blank" href="https://x.com/YatinDora" className="text-muted-foreground hover:text-primary">
                                <Twitter className="w-5 h-5" />
                            </a>
                            <a target="_blank" href="https://www.linkedin.com/in/yatin-dora/" className="text-muted-foreground hover:text-primary">
                                <Linkedin className="w-5 h-5" />
                            </a>
                            <a target="_blank" href="https://github.com/YatinDora81" className="text-muted-foreground hover:text-primary">
                                <Github className="w-5 h-5" />
                            </a>
                        </div>
                    </div>
                </div>
            </footer>

        </div>
    )
}