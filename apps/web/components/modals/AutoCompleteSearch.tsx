"use state"
import React from 'react'
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import { Input } from '../ui/input'
import { CiSearch } from "react-icons/ci";
import { IoMdClose } from "react-icons/io";

function AutoCompleteSearch({ setOpen, searchFor = "String" }: { setOpen?: (v: boolean) => void, searchFor?: string }) {

    const dummyData = ["Frontend", "Backend", "Full Stack", "Devops", "Data Science", "AI", "Cyber Security", "Blockchain", "UI/UX Design", "Game Development", "Mobile Development", "Database Management", "System Administration", "Network Engineering"]

    return (
        <div className='shadow-[0_3px_10px_rgb(0,0,0,0.2)] rounded-xl min-w-[85%] md:min-w-[65%] lg:min-w-[45%] h-[65vh] flex flex-col justify-start items-start gap-2' onClick={(e) => { e.stopPropagation() }}>
            <div className="relative flex items-center  w-full ">
                <CiSearch className="absolute left-2 top-1/2 h-5 w-5 -translate-y-1/2 transform" />
                <Input
                    type='text'
                    style={{ fontSize: '1rem' }}
                    placeholder="Search here..."
                    // value={search}
                    // onChange={(event) => setSearch(event.target.value)}
                    className=" px-8 h-12 "

                />
                <IoMdClose className=' absolute right-3 hover:text-red-500 transition-colors duration-150 top-1/2 h-5 w-5 -translate-y-1/2 transform' />
            </div>

            <Card className=' w-full flex-1 flex flex-col '>
                <CardHeader>
                    <CardTitle className=' text-lg'>Search for <span className=' font-bold'>{searchFor}</span></CardTitle>
                </CardHeader>

                {/* FIX: put results/empty state inside CardContent instead of CardHeader */}
                <CardContent className='flex-1 flex-col -my-5 flex justify-evenly items-center overflow-y-auto max-h-[54vh] '>
                    {[...dummyData.slice(0, 10)].map((item, index) => (
                        <div key={index} className=' w-full h-8 flex justify-start items-center border-b hover:bg-zinc-100 rounded-md hover:text-black text-lg py-5 transition-colors duration-75 px-3 '>{item}</div>
                    ))}
                    {[...dummyData.slice(0, 10)].map((item, index) => (
                        <div key={index} className=' w-full h-8 flex justify-start items-center border-b hover:bg-zinc-100 rounded-md hover:text-black text-lg py-5 transition-colors duration-75 px-3 '>{item}</div>
                    ))}
                    {/* <div
                        className="w-full h-full flex flex-col justify-center items-center
                                  text-base italic
                                   borde border-gray-300 dark:border-gray-600
                                   rounded-lg 
                                   transition-all duration-200 mb-4"
                    >
                        <CiSearch className="mb-3 h-8 w-8 text-gray-400" />
                        <span>No search results</span>
                    </div> */}
                </CardContent>
            </Card>
        </div>
    )
}

export default AutoCompleteSearch
