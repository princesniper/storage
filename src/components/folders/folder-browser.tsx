"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, FileArchive, FileCode2, FileText, Folder, FolderOpen, Grid2X2, Image as ImageIcon, List, Music, Play, Search, Trash2, Video, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MediaLightbox } from "@/components/media/media-lightbox";
import type { MediaFile } from "@/components/media/media-card";
import { VideoThumbnail } from "@/components/media/video-thumbnail";
import { formatBytes, formatDate, isAudioMime, isVideoMime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { NewFolderButton, FolderActions } from "@/components/folders/folder-actions";
import { FOLDER_MIME_OPTIONS, FOLDER_SORT_OPTIONS, sortByMetadata, type FolderSortKey } from "@/lib/folder-sorting";

type FolderRow = { id:number; name:string; parentId:number|null; childFolderCount:number; fileCount:number; totalFileCount?:number; totalFolderCount?:number; totalSize?:number; createdAt?:string; updatedAt?:string; lastModified?:string };
type FileRow = MediaFile & { thumbnailPublicId?:string|null; status?:string; updatedAt?:string; lastModified?:string };
type ViewMode = "grid" | "list";

function renderFileIcon(mime:string,className:string){
  if(mime.includes("pdf")) return <FileText className={className}/>;
  if(mime.includes("zip")||mime.includes("archive")||mime.includes("compressed")) return <FileArchive className={className}/>;
  if(mime.includes("javascript")||mime.includes("typescript")||mime.includes("json")||mime.includes("xml")||mime.includes("css")||mime.includes("html")) return <FileCode2 className={className}/>;
  return <FileText className={className}/>;
}

function FolderCard({folder,onOpen}:{folder:FolderRow;onOpen:()=>void}){
  return <div className="group rounded-2xl border border-border/70 bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg">
    <div className="mb-4 flex items-start justify-between gap-2">
      <button onClick={onOpen} className="rounded-xl bg-primary/10 p-3 text-primary"><FolderOpen className="h-7 w-7"/></button>
      <div className="flex items-center gap-1"><FolderActions itemType="folder" itemId={folder.id} itemName={folder.name}/><button onClick={onOpen} className="rounded p-2 hover:bg-muted"><ChevronRight className="h-4 w-4 text-muted-foreground"/></button></div>
    </div>
    <button onClick={onOpen} className="w-full text-left"><div className="truncate font-semibold">{folder.name}</div><div className="mt-1 text-xs text-muted-foreground">{folder.fileCount} files · {folder.childFolderCount} folders</div><div className="mt-1 text-sm font-medium">{formatBytes(folder.totalSize??0)}</div>{folder.lastModified&&<div className="mt-2 text-[11px] text-muted-foreground">Updated {formatDate(folder.lastModified)}</div>}</button>
  </div>;
}

function FileCard({file,onOpen}:{file:FileRow;onOpen:()=>void}){
  const isImage=file.mimeType.startsWith("image/"),isVideo=isVideoMime(file.mimeType),isAudio=isAudioMime(file.mimeType);
  return <div className="group overflow-hidden rounded-2xl border border-border/70 bg-card transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg">
    <button onClick={onOpen} className="block w-full text-left"><div className="aspect-square bg-muted/30">
      {isImage?<img src={file.publicUrl} alt={file.originalName} loading="lazy" className="h-full w-full object-cover"/>:isVideo?<div className="relative h-full w-full"><VideoThumbnail src={file.publicUrl} alt={file.originalName} className="h-full w-full object-cover" fallback={<div className="flex h-full w-full items-center justify-center"><Video className="h-12 w-12 text-muted-foreground/50"/></div>}/><span className="absolute bottom-3 left-3 rounded-full bg-black/70 px-2 py-1 text-[10px] text-white"><Play className="mr-1 inline h-3 w-3 fill-current"/>VIDEO</span></div>:isAudio?<div className="flex h-full items-center justify-center text-muted-foreground"><Music className="h-12 w-12"/></div>:<div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">{renderFileIcon(file.mimeType,"h-12 w-12")}<span className="max-w-[80%] truncate text-xs">{file.mimeType.split("/").pop()}</span></div>}
    </div><div className="p-3"><div className="truncate text-sm font-medium">{file.originalName}</div><div className="mt-1 text-xs text-muted-foreground">{formatBytes(file.size)} · {formatDate(file.createdAt)}</div></div></button>
    <div className="flex justify-end border-t px-2 py-1"><FolderActions itemType="file" itemId={file.id} itemName={file.originalName} fileUrl={file.publicUrl}/></div>
  </div>;
}

export default function FolderBrowser(){
  const router=useRouter(),params=useSearchParams(),folderId=Number(params.get("folderId"))||null;
  const initialSort = params.get("sort");
  const sort: FolderSortKey = FOLDER_SORT_OPTIONS.some(option=>option.value===initialSort)?initialSort as FolderSortKey:"created:desc";
  const status = params.get("status") ?? "active";
  const mimeType = params.get("mimeType") ?? "all";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const [search,setSearch]=useState(""),[view,setView]=useState<ViewMode>("grid"),[openFile,setOpenFile]=useState<FileRow|null>(null),[shareBusy,setShareBusy]=useState(false),[shareCopied,setShareCopied]=useState(false),[deleteBusy,setDeleteBusy]=useState(false);
  const foldersQuery=useQuery<FolderRow[]>({queryKey:["folder-browser","folders"],queryFn:async()=>{const r=await fetch("/api/folders?all=true");if(!r.ok)throw Error("Failed to load folders");return(await r.json()).folders??[];}});
  const current=foldersQuery.data?.find(f=>f.id===folderId)??null;
  const childFolders=useMemo(()=>sortByMetadata((foldersQuery.data??[]).filter(f=>f.parentId===folderId).filter(f=>f.name.toLowerCase().includes(search.toLowerCase())).filter(f=>!from||!!f.createdAt&&new Date(f.createdAt)>=new Date(from)).filter(f=>!to||!!f.createdAt&&new Date(f.createdAt)<=new Date(`${to}T23:59:59.999`)),sort),[foldersQuery.data,folderId,search,sort,from,to]);
  const filesQuery=useQuery<{files:FileRow[];total:number}>({queryKey:["folder-browser","files",folderId,status,mimeType,from,to],enabled:folderId!==null,queryFn:async()=>{
    const limit=100;
    const fetchPage=async(page:number)=>{const query=new URLSearchParams({folderId:String(folderId),status,sort:"created",order:"desc",page:String(page),limit:String(limit)});if(mimeType!=="all")query.set("mimeType",mimeType);if(from)query.set("from",from);if(to)query.set("to",to);const r=await fetch(`/api/files?${query}`,{cache:"no-store"});if(!r.ok)throw Error("Failed to load folder files");return (await r.json()) as {files:FileRow[];total:number;page:number;limit:number};};
    const first=await fetchPage(1);
    const totalPages=Math.ceil(first.total/limit);
    if(totalPages<=1)return first;
    const rest=await Promise.all(Array.from({length:totalPages-1},(_,i)=>fetchPage(i+2)));
    return {...first,files:[...first.files,...rest.flatMap(page=>page.files)]};
  }});
  const files=useMemo(()=>sortByMetadata((filesQuery.data?.files??[]).filter(f=>f.originalName.toLowerCase().includes(search.toLowerCase())),sort),[filesQuery.data?.files,search,sort]);
  const visibleMedia=files.filter(f=>f.mimeType.startsWith("image/")||isVideoMime(f.mimeType)||isAudioMime(f.mimeType));
  const path=useMemo(()=>{const map=new Map((foldersQuery.data??[]).map(f=>[f.id,f]));const out:FolderRow[]=[];let id=folderId;const seen=new Set<number>();while(id&& !seen.has(id)){seen.add(id);const f=map.get(id);if(!f)break;out.unshift(f);id=f.parentId;}return out;},[foldersQuery.data,folderId]);
  const go=(id:number|null)=>{const next=new URLSearchParams(params.toString());if(id)next.set("folderId",String(id));else next.delete("folderId");router.push(`/folders${next.size?`?${next.toString()}`:""}`);};
  const changeFilter=(key:string,value:string)=>{const next=new URLSearchParams(params.toString());if(key==="status")next.set(key,value);else if(value&&value!=="all")next.set(key,value);else next.delete(key);router.replace(`/folders?${next.toString()}`,{scroll:false});};
  const hasActiveFilters=mimeType!=="all"||status!=="active"||Boolean(from||to);
  const clearFilters=()=>{const next=new URLSearchParams(params.toString());["status","mimeType","from","to"].forEach(key=>next.delete(key));router.replace(`/folders?${next.toString()}`,{scroll:false});};
  const share=async()=>{if(!current||shareBusy)return;setShareBusy(true);try{const r=await fetch(`/api/folders/${current.id}/share`,{method:"POST"});const j=await r.json();if(!r.ok)throw Error(j.detail||j.error||"Failed to generate share link");await navigator.clipboard.writeText(j.url);setShareCopied(true);setTimeout(()=>setShareCopied(false),2500);}catch(e){alert(e instanceof Error?e.message:"Failed to generate share link")}finally{setShareBusy(false)}};
  const deleteCurrent=async()=>{if(!current||deleteBusy)return;if(!confirm(`Delete folder "${current.name}" and all files inside it? This cannot be undone.`))return;setDeleteBusy(true);try{const r=await fetch(`/api/folders/${current.id}`,{method:"DELETE"});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.detail||j.error||"Failed to delete folder");await foldersQuery.refetch();go(current.parentId);}catch(e){alert(e instanceof Error?e.message:"Failed to delete folder")}finally{setDeleteBusy(false)}};
  const loading=foldersQuery.isLoading||(folderId!==null&&filesQuery.isLoading);
  return <div className="space-y-6 p-6">
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div><div className="flex items-center gap-2 text-sm text-muted-foreground"><button onClick={()=>go(null)} className="hover:text-foreground">Home</button>{path.map(f=><span key={f.id} className="flex items-center gap-2"><ChevronRight className="h-3 w-3"/><button onClick={()=>go(f.id)} className="max-w-40 truncate hover:text-foreground">{f.name}</button></span>)}</div><h1 className="mt-2 text-2xl font-semibold">{current?.name??"My Storage"}</h1><p className="text-sm text-muted-foreground">{current?`${hasActiveFilters||search?files.length:current.totalFileCount??current.fileCount} files · ${formatBytes(current.totalSize??0)}`:"Folders and media stored in your database."}</p></div>
      <div className="flex flex-wrap gap-2"><NewFolderButton parentId={folderId}/>{current&&<Button variant="outline" onClick={()=>router.push(`/upload?folderId=${current.id}`)}><Folder className="mr-2 h-4 w-4"/>Upload Files</Button>}<Button variant="outline" onClick={()=>router.push("/folders?upload=1")}><FolderOpen className="mr-2 h-4 w-4"/>Upload Folder</Button>{current&&<Button variant="outline" onClick={share} disabled={shareBusy}><Link2 className="mr-2 h-4 w-4"/>{shareBusy?"Generating...":shareCopied?"Link Copied":"Copy Share Link"}</Button>}{current&&<Button variant="destructive" onClick={deleteCurrent} disabled={deleteBusy}><Trash2 className="mr-2 h-4 w-4"/>{deleteBusy?"Deleting...":"Delete Folder"}</Button>}</div>
    </div>
    {folderId!==null&&<Button variant="ghost" size="sm" onClick={()=>go(current?.parentId??null)}><ArrowLeft className="mr-2 h-4 w-4"/>Back</Button>}
    <div className="space-y-3 rounded-xl border border-border/70 bg-card/40 p-3 md:p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center"><div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"/><Input value={search} onChange={e=>setSearch(e.target.value)} placeholder={`Search ${current?"this folder":"folders"}...`} className="pl-9" aria-label="Search folders and files"/></div><label className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">Status<select aria-label="Status filter" value={status} onChange={e=>changeFilter("status",e.target.value)} className="h-10 min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><option value="active">Active</option><option value="deleted">Deleted</option><option value="all">All</option></select></label><label className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">Sort by<select aria-label="Sort folders and files" value={sort} onChange={e=>changeFilter("sort",e.target.value)} className="h-10 min-w-0 max-w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{FOLDER_SORT_OPTIONS.map(option=><option key={option.value} value={option.value}>{option.value==="created:desc"?"Newest first":option.value==="created:asc"?"Oldest first":option.value==="name:asc"?"Name A → Z":option.value==="name:desc"?"Name Z → A":option.label}</option>)}</select></label><div className="flex shrink-0 rounded-lg border p-1"><Button variant={view==="grid"?"secondary":"ghost"} size="sm" aria-label="Grid view" aria-pressed={view==="grid"} onClick={()=>setView("grid")}><Grid2X2 className="h-4 w-4"/></Button><Button variant={view==="list"?"secondary":"ghost"} size="sm" aria-label="List view" aria-pressed={view==="list"} onClick={()=>setView("list")}><List className="h-4 w-4"/></Button></div></div>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center"><div className="flex flex-wrap items-center gap-2" aria-label="File type filter">{FOLDER_MIME_OPTIONS.map(option=><button key={option.value} type="button" aria-pressed={mimeType===option.value} onClick={()=>changeFilter("mimeType",option.value)} className={cn("rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",mimeType===option.value?"border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400":"border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground")}>{option.label}</button>)}</div><div className="flex flex-wrap items-center gap-2 xl:ml-auto"><label className="flex items-center gap-2 text-xs text-muted-foreground">From<Input type="date" aria-label="From date" value={from} max={to||undefined} onChange={e=>changeFilter("from",e.target.value)} className="h-9 w-[145px]"/></label><label className="flex items-center gap-2 text-xs text-muted-foreground">To<Input type="date" aria-label="To date" value={to} min={from||undefined} onChange={e=>changeFilter("to",e.target.value)} className="h-9 w-[145px]"/></label>{hasActiveFilters&&<Button variant="ghost" size="sm" onClick={clearFilters} className="h-9"><X className="mr-1 h-3.5 w-3.5"/>Clear</Button>}</div></div>
    </div>
    {loading?<div className="rounded-2xl border p-12 text-center text-sm text-muted-foreground">Loading storage...</div>:<>
      {childFolders.length>0&&<section className="space-y-3"><h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Folders</h2>{view==="grid"?<div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{childFolders.map(f=><FolderCard key={f.id} folder={f} onOpen={()=>go(f.id)}/>)}</div>:<div className="space-y-2">{childFolders.map(f=><div key={f.id} className="flex items-center gap-3 rounded-xl border p-3"><button onClick={()=>go(f.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left"><Folder className="h-5 w-5 text-primary"/><span className="truncate">{f.name}</span><span className="text-xs text-muted-foreground">{f.fileCount} files</span></button><FolderActions itemType="folder" itemId={f.id} itemName={f.name}/></div>)}</div>}</section>}
      {folderId!==null&&files.length>0&&<section className="space-y-3"><h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Files</h2>{view==="grid"?<div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">{files.map(f=><FileCard key={f.id} file={f} onOpen={()=>setOpenFile(f)}/>)}</div>:<div className="divide-y rounded-xl border">{files.map(f=><div key={f.id} className="flex items-center gap-3 p-3 hover:bg-muted/40"><button onClick={()=>setOpenFile(f)} className="flex min-w-0 flex-1 items-center gap-3 text-left"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">{f.mimeType.startsWith("image/")?<ImageIcon className="h-5 w-5"/>:f.mimeType.startsWith("audio/")?<Music className="h-5 w-5"/>:<FileText className="h-5 w-5"/>}</div><span className="truncate text-sm">{f.originalName}</span><span className="text-xs text-muted-foreground">{f.mimeType.split("/").pop()}</span><span className="w-20 text-right text-xs text-muted-foreground">{formatBytes(f.size)}</span></button><FolderActions itemType="file" itemId={f.id} itemName={f.originalName}/></div>)}</div>}</section>}
      {folderId!==null&&!childFolders.length&&!files.length&&<div className="rounded-2xl border p-12 text-center"><Folder className="mx-auto h-12 w-12 text-muted-foreground/40"/><h3 className="mt-3 font-medium">This folder is empty</h3><p className="mt-1 text-sm text-muted-foreground">Upload files or create a folder to get started.</p></div>}
      {folderId===null&&!childFolders.length&&<div className="rounded-2xl border p-12 text-center"><Folder className="mx-auto h-12 w-12 text-muted-foreground/40"/><h3 className="mt-3 font-medium">No folders yet</h3><p className="mt-1 text-sm text-muted-foreground">Create your first folder above.</p></div>}
    </>}
    <MediaLightbox file={openFile} siblings={visibleMedia.map(f=>f.id)} open={!!openFile} onClose={()=>setOpenFile(null)} onNavigate={id=>setOpenFile(visibleMedia.find(f=>f.id===id)??null)}/>
  </div>;
}
