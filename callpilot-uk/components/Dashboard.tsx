"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  Activity, Bot, Building2, CalendarDays, CircleHelp,
  Headphones, LayoutDashboard, LifeBuoy, Loader2, LogOut, Menu,
  Phone, Plus, Search, Settings, ShieldCheck, Sparkles, Users,
  X, ArrowUpRight, CheckCircle2, AlertCircle, MoreHorizontal
} from "lucide-react";
import { signOut } from "@/app/actions/auth";
import { createBusiness, type BusinessFormState } from "@/app/actions/businesses";
import { formatDuration, type Business, type BusinessStatus, type CallOutcome, type CallRecord, type DashboardData } from "@/lib/dashboard";
import { BUSINESS_TYPES } from "@/lib/validation";

type Tab = "Overview" | "Businesses" | "Call activity" | "Receptionists" | "Settings";

const AVATAR_COLOURS = ["blue", "pink", "green", "purple"];
const STATUS_LABELS: Record<BusinessStatus, string> = { setup_needed: "Setup needed", active: "Active", paused: "Paused" };
const OUTCOME_LABELS: Record<CallOutcome, string> = {
  answered: "Answered",
  lead_captured: "Lead captured",
  booking_requested: "Booking requested",
  transferred: "Transferred",
  missed: "Missed",
};

function initials(text: string) {
  return text.split(/\s+/).filter(Boolean).map(s => s[0]).slice(0, 2).join("").toUpperCase();
}

function formatCallTime(iso: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }).format(new Date(iso));
}

export function Dashboard({ data }: { data: DashboardData }) {
  const { user, workspace, businesses, recentCalls, stats } = data;
  const [tab, setTab] = useState<Tab>("Overview");
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [notice, setNotice] = useState("");

  const filtered = businesses.filter(c => `${c.name} ${c.businessType}`.toLowerCase().includes(search.toLowerCase()));
  const hasCalls = stats.totalCalls > 0;
  const setupDone = [businesses.length > 0, false, false, false].filter(Boolean).length;
  const userInitials = initials(user.email.split("@")[0].replace(/[._-]+/g, " ")) || "ME";
  const navItems: { label: Tab; icon: typeof LayoutDashboard }[] = [
    { label: "Overview", icon: LayoutDashboard },
    { label: "Businesses", icon: Building2 },
    { label: "Call activity", icon: Phone },
    { label: "Receptionists", icon: Bot },
    { label: "Settings", icon: Settings },
  ];

  function onBusinessAdded(message: string) {
    setShowAdd(false);
    setTab("Businesses");
    setNotice(message);
  }

  return (
    <main className="app-shell">
      {mobileNav && <button className="mobile-backdrop" onClick={() => setMobileNav(false)} aria-label="Close navigation" />}
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><Headphones size={22} strokeWidth={2.5} /></div>
          <div><div className="brand-name">CallPilot<span>UK</span></div><div className="brand-sub">AI RECEPTIONIST PLATFORM</div></div>
          <button className="mobile-close" onClick={() => setMobileNav(false)} aria-label="Close menu"><X size={19}/></button>
        </div>
        <div className="workspace"><div className="workspace-avatar">{initials(workspace.name) || "WS"}</div><div className="workspace-text"><strong>{workspace.name}</strong><span>{workspace.role === "owner" ? "Owner account" : `${workspace.role} access`}</span></div></div>
        <div className="nav-label">WORKSPACE</div>
        <nav>{navItems.map(({label, icon: Icon}) => (
          <button key={label} className={`nav-item ${tab === label ? "nav-active" : ""}`} onClick={() => {setTab(label);setMobileNav(false);}}>
            <Icon size={18}/><span>{label}</span>{label === "Call activity" && hasCalls && <span className="nav-count">{recentCalls.length}</span>}
          </button>
        ))}</nav>
        <div className="sidebar-bottom">
          <div className="help-card"><div className="help-icon"><CircleHelp size={17}/></div><strong>Need a hand?</strong><p>Your setup guide will help you connect your first receptionist.</p><button onClick={() => setNotice("Setup guide: add a business, choose a telephony provider, configure the voice agent, then run test calls.")}>Open setup guide <ArrowUpRight size={14}/></button></div>
          <div className="profile">
            <div className="profile-avatar">{userInitials}</div>
            <div className="profile-text"><strong title={user.email}>{user.email}</strong><span>Signed in</span></div>
            <form action={signOut}><button type="submit" className="icon-button signout-button" aria-label="Sign out" title="Sign out"><LogOut size={17}/></button></form>
          </div>
        </div>
      </aside>

      <section className="main-area">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu size={21}/></button>
          <div className="breadcrumbs">{workspace.name} <span>/</span> <strong>{tab}</strong></div>
          <div className="top-actions"><div className="demo-pill"><span/> No live calls</div><button className="icon-button" onClick={() => setNotice("Help centre will be connected in a later version.")} aria-label="Help"><CircleHelp size={18}/></button><div className="top-avatar">{userInitials}</div></div>
        </header>

        <div className="page-content">
          {notice && <div className="notice" role="status"><AlertCircle size={17}/><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss"><X size={16}/></button></div>}
          <div className="page-heading">
            <div><div className="eyebrow"><Sparkles size={14}/> YOUR AI RECEPTIONIST CONTROL CENTRE</div><h1>{tab === "Overview" ? "Here's your overview." : tab}</h1><p>{tab === "Overview" ? "See what your receptionists have been up to across your businesses." : `Manage your ${tab.toLowerCase()} in one place.`}</p></div>
            <button className="primary-button" onClick={() => setShowAdd(true)}><Plus size={17}/> Add a business</button>
          </div>

          {tab === "Overview" && <>
            {businesses.length === 0 && <div className="welcome-banner"><div className="welcome-symbol"><Bot size={26}/></div><div className="welcome-copy"><strong>Your workspace is ready to set up</strong><p>Add your first business, then connect a UK-compatible phone provider to start testing an AI receptionist.</p></div><button onClick={() => setTab("Receptionists")}>View setup steps <ArrowUpRight size={15}/></button></div>}
            <div className="stats-grid">
              <Stat icon={<Phone size={19}/>} label="Calls handled" value={String(stats.totalCalls)} change={hasCalls ? "All time" : "No calls yet"} tone="violet"/>
              <Stat icon={<Users size={19}/>} label="Enquiries captured" value={String(stats.leadsCaptured)} change={hasCalls ? "All time" : "No calls yet"} tone="blue"/>
              <Stat icon={<CalendarDays size={19}/>} label="Booking requests" value={String(stats.bookingRequests)} change={hasCalls ? "All time" : "No calls yet"} tone="green"/>
              <Stat icon={<Activity size={19}/>} label="Avg. call duration" value={hasCalls ? formatDuration(stats.avgDurationSeconds) : "–"} change={hasCalls ? "All time" : "No calls yet"} tone="orange"/>
            </div>
            <div className="content-grid">
              <section className="panel businesses-panel">
                <div className="panel-heading"><div><h2>Your businesses</h2><p>Manage the companies using your service</p></div><button className="text-button" onClick={() => setTab("Businesses")}>View all <ArrowUpRight size={14}/></button></div>
                {businesses.length === 0
                  ? <EmptyState text="No businesses yet. Add one to get started." />
                  : <div className="business-list">{businesses.slice(0,4).map((client, i) => <BusinessRow key={client.id} client={client} colour={AVATAR_COLOURS[i % AVATAR_COLOURS.length]}/>)}</div>}
                <button className="panel-footer-button" onClick={() => setShowAdd(true)}><Plus size={16}/> Add {businesses.length ? "another" : "a"} business</button>
              </section>
              <section className="panel activity-panel">
                <div className="panel-heading"><div><h2>Recent call activity</h2><p>Latest conversations across your workspace</p></div><button className="text-button" onClick={() => setTab("Call activity")}>View all <ArrowUpRight size={14}/></button></div>
                {recentCalls.length === 0
                  ? <EmptyState text="No calls yet. Calls will appear here once a phone provider is connected." />
                  : <div className="call-list">{recentCalls.slice(0,3).map(call => <CallRow key={call.id} call={call}/>)}</div>}
                <div className="activity-note"><ShieldCheck size={15}/> No telephony provider is connected — no real calls are being processed.</div>
              </section>
            </div>
            <section className="setup-panel panel">
              <div className="setup-title"><div className="setup-icon"><Sparkles size={19}/></div><div><h2>Get ready for your first live receptionist</h2><p>Complete these steps before you connect real calls.</p></div><span className="setup-progress">{setupDone} of 4 complete</span></div>
              <div className="setup-steps">
                <SetupStep n="01" title="Add your first business" detail="Business name, services and opening hours" done={businesses.length > 0} onClick={() => setShowAdd(true)}/>
                <SetupStep n="02" title="Choose a UK phone provider" detail="Confirm UK number availability and pricing" done={false} onClick={() => setNotice("Provider selection is not wired up yet. We will evaluate UK number availability, call routing and usage rates before choosing.")}/>
                <SetupStep n="03" title="Configure the AI receptionist" detail="Greeting, FAQs, call handling and escalation" done={false} onClick={() => setTab("Receptionists")}/>
                <SetupStep n="04" title="Run test calls" detail="Verify accuracy, transfers and notifications" done={false} onClick={() => setNotice("Live test calls are not enabled yet. Connect and test a provider before production use.")}/>
              </div>
            </section>
          </>}

          {tab === "Businesses" && <section className="panel full-panel"><div className="panel-heading"><div><h2>All businesses</h2><p>{businesses.length} {businesses.length === 1 ? "business" : "businesses"} in your workspace</p></div><button className="primary-button small" onClick={() => setShowAdd(true)}><Plus size={16}/> Add business</button></div>
            {businesses.length === 0 ? <EmptyState text="No businesses yet. Add one to get started." /> : <>
              <div className="table-tools"><div className="search-box"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search businesses..." aria-label="Search businesses" /></div><span>{filtered.length} results</span></div>
              <div className="table-wrap"><table><thead><tr><th>BUSINESS</th><th>PHONE NUMBER</th><th>CALLS</th><th>STATUS</th><th></th></tr></thead><tbody>{filtered.map((c,i)=><tr key={c.id}><td><div className="table-business"><div className={`business-avatar ${AVATAR_COLOURS[i % AVATAR_COLOURS.length]}`}>{initials(c.name)}</div><div><strong>{c.name}</strong><span>{c.businessType}</span></div></div></td><td>{c.phoneNumber ?? "Not connected"}</td><td>{c.callCount}</td><td><Status status={c.status}/></td><td><button className="row-action" onClick={() => setNotice(`${c.name}: client details editing will be added in the next build stage.`)} aria-label="Business actions"><MoreHorizontal size={18}/></button></td></tr>)}</tbody></table></div>
            </>}
          </section>}

          {tab === "Call activity" && <section className="panel full-panel"><div className="panel-heading"><div><h2>Call activity</h2><p>Review call outcomes and enquiry summaries</p></div></div>
            {recentCalls.length === 0
              ? <EmptyState text="No calls yet. Call records will appear here once a phone provider is connected and tested." />
              : <div className="call-list expanded">{recentCalls.map(call=><CallRow key={call.id} call={call}/>)}</div>}
            <div className="activity-note"><ShieldCheck size={15}/> Only real or clearly-marked test calls are stored here.</div>
          </section>}

          {tab === "Receptionists" && <section className="panel full-panel"><div className="panel-heading"><div><h2>Receptionist setup</h2><p>Configure the behaviour of each business&apos;s AI receptionist</p></div><span className="setup-progress">Coming soon</span></div><div className="receptionist-empty"><div className="large-bot"><Bot size={32}/></div><h3>Build your first receptionist</h3><p>Start by adding a business. Then define its greeting, FAQs, services, opening hours and when a call should be transferred to a human.</p><button className="primary-button" onClick={() => setShowAdd(true)}><Plus size={17}/> Add a business</button><div className="feature-pills"><span><CheckCircle2 size={14}/> British English voice (provider-dependent)</span><span><CheckCircle2 size={14}/> Lead capture</span><span><CheckCircle2 size={14}/> Call summaries</span></div></div></section>}

          {tab === "Settings" && <section className="panel full-panel"><div className="panel-heading"><div><h2>Workspace settings</h2><p>Configure your platform defaults</p></div></div><div className="settings-list"><Setting icon={<Building2 size={18}/>} title="Workspace profile" detail={`${workspace.name} · signed in as ${user.email}`} onClick={() => setNotice("Workspace profile editing will be added in a later stage.")}/><Setting icon={<Phone size={18}/>} title="Telephony provider" detail="No provider connected yet" onClick={() => setNotice("No phone provider is connected. Provider credentials will be stored securely on the server.")}/><Setting icon={<ShieldCheck size={18}/>} title="Privacy and security" detail="Email sign-in with per-workspace access controls" onClick={() => setNotice("Your data is only visible to members of this workspace. Data retention and deletion controls come in a later stage.")}/><Setting icon={<LifeBuoy size={18}/>} title="Support and documentation" detail="Setup instructions and troubleshooting" onClick={() => setNotice("Documentation will be expanded as integrations are added.")}/></div></section>}
          <footer className="page-footer"><span>CallPilot UK · Early access</span><span><span className="footer-dot"/> No telephony provider connected</span></footer>
        </div>
      </section>

      {showAdd && <AddBusinessModal workspaceId={workspace.id} onClose={() => setShowAdd(false)} onAdded={onBusinessAdded} />}
    </main>
  );
}

function AddBusinessModal({ workspaceId, onClose, onAdded }: { workspaceId: string; onClose: () => void; onAdded: (message: string) => void }) {
  const [state, formAction] = useFormState<BusinessFormState, FormData>(createBusiness, {});
  const handled = useRef<BusinessFormState | null>(null);

  useEffect(() => {
    if (state.ok && handled.current !== state) {
      handled.current = state;
      onAdded(state.message ?? "Business added.");
    }
  }, [state, onAdded]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="add-business-title" onClick={e=>e.stopPropagation()}>
        <div className="modal-heading"><div><h2 id="add-business-title">Add a business</h2><p>Create a client profile in your workspace.</p></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={19}/></button></div>
        {state.message && !state.ok && <div className="form-alert" role="alert"><AlertCircle size={16}/> {state.message}</div>}
        <form action={formAction} noValidate>
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <label>Business name
            <input name="name" autoFocus required minLength={2} maxLength={100} placeholder="e.g. Smith & Sons Plumbing" aria-invalid={!!state.errors?.name} aria-describedby={state.errors?.name ? "name-error" : undefined}/>
            {state.errors?.name && <span className="field-error" id="name-error">{state.errors.name}</span>}
          </label>
          <label>Business type
            <select name="businessType" defaultValue="Other" aria-invalid={!!state.errors?.businessType}>{BUSINESS_TYPES.map(t => <option key={t}>{t}</option>)}</select>
            {state.errors?.businessType && <span className="field-error">{state.errors.businessType}</span>}
          </label>
          {state.errors?.workspaceId && <span className="field-error">{state.errors.workspaceId}</span>}
          <div className="modal-note"><AlertCircle size={16}/> This saves the business profile only. A live phone number is not assigned.</div>
          <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><CreateButton/></div>
        </form>
      </div>
    </div>
  );
}

function CreateButton() {
  const { pending } = useFormStatus();
  return <button type="submit" className="primary-button" disabled={pending} aria-busy={pending}>{pending ? <Loader2 size={16} className="spin"/> : <Plus size={16}/>} {pending ? "Saving…" : "Create business"}</button>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}
function Stat({icon,label,value,change,tone}:{icon:React.ReactNode;label:string;value:string;change:string;tone:string}) {
  return <div className="stat-card"><div className={`stat-icon ${tone}`}>{icon}</div><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-change"><span className="tiny-dot"/> {change}</div></div>;
}
function Status({status}:{status:BusinessStatus}) {
  return <span className={`status ${status==="active"?"status-active":"status-pending"}`}><span/>{STATUS_LABELS[status]}</span>;
}
function BusinessRow({client, colour}:{client:Business; colour:string}) {
  return <div className="business-row"><div className={`business-avatar ${colour}`}>{initials(client.name)}</div><div className="business-details"><strong>{client.name}</strong><span>{client.businessType}</span></div><div className="business-row-right"><Status status={client.status}/><span className="call-count">{client.callCount} calls</span></div></div>;
}
function CallRow({call}:{call:CallRecord}) {
  const tone = call.outcome==="lead_captured"?"lead":call.outcome==="booking_requested"?"booking":"answered";
  return <div className="call-row"><div className="call-avatar">{initials(call.businessName)}</div><div className="call-main"><strong>{call.businessName}{call.isTest && " · Test"}</strong><span>{call.summary ?? "No summary"}</span><small>{formatCallTime(call.startedAt)} · {formatDuration(call.durationSeconds)}</small></div><span className={`call-status ${tone}`}>{OUTCOME_LABELS[call.outcome]}</span></div>;
}
function SetupStep({n,title,detail,done,onClick}:{n:string;title:string;detail:string;done:boolean;onClick:()=>void}) {
  return <button className="setup-step" onClick={onClick}><span className="step-number">{done?<CheckCircle2 size={17}/>:n}</span><span className="step-copy"><strong>{title}</strong><small>{detail}</small></span><ArrowUpRight size={16} className="step-arrow"/></button>;
}
function Setting({icon,title,detail,onClick}:{icon:React.ReactNode;title:string;detail:string;onClick:()=>void}) {
  return <button className="setting-row" onClick={onClick}><div className="setting-icon">{icon}</div><div><strong>{title}</strong><span>{detail}</span></div><ArrowUpRight size={16}/></button>;
}
