import React, { useState, useEffect, useMemo, useCallback, useId } from "react";
import {
  Sparkles, Plus, Search, MapPin, Calendar, DollarSign, ExternalLink,
  X, Briefcase, Clock, Star, Trash2, Pencil, Home, Building2, Wifi,
  ChevronDown, ArrowUpDown, Link2, Loader2, LayoutGrid, BarChart3, Inbox, History,
  Zap,
  Video, Phone, Eye, EyeOff, StickyNote, Settings, Check,
  User, Mail, Lock, GraduationCap, LogOut, ArrowRight, ArrowLeft, SkipForward, Award,
  Repeat, FileText, Bug, RotateCcw, Gamepad2, Puzzle, Brain, Grid3x3, Hexagon, Hash, HeartHandshake,
  Lightbulb, Terminal, Route,
} from "lucide-react";
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line,
} from "recharts";

/* ---------------------------------------------------------------------- */
/*  Internly - internship application tracker                             */
/* ---------------------------------------------------------------------- */

/* ---------------------------------------------------------------------- *
 * SUPABASE CONFIG - fill these in with your own project's values
 * (Supabase dashboard → Settings → API). The anon/public key is safe to
 * ship in client code; it only grants what your Row Level Security
 * policies allow.
 *
 * Required setup in your Supabase project:
 *
 * 1. Auth → Providers → Email - enabled by default. If "Confirm email"
 *    is turned on, sign-up won't return a session immediately (see
 *    sbSignUp below) - turn it off for a simple single-page app like
 *    this one, or add an email-confirmation step to AuthFlow yourself.
 *
 * 2. Run this SQL once (SQL Editor in the dashboard) to create the
 *    table every piece of app data (internships, GPA, scholarships,
 *    volunteering, logo/settings) is stored in, keyed by a string and
 *    scoped to the signed-in user:
 *
 *    create table app_data (
 *      user_id uuid references auth.users not null,
 *      key text not null,
 *      value jsonb not null,
 *      updated_at timestamptz default now(),
 *      primary key (user_id, key)
 *    );
 *    alter table app_data enable row level security;
 *    create policy "Users manage their own data" on app_data
 *      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
 * ---------------------------------------------------------------------- */
const SUPABASE_URL = "https://nouvceurissdefoyrhvr.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_vjY0gTF6ZxyV4_ZT0poIFg_NaK36cxS";

const SB_SESSION_KEY = "internly:sb-session";
const SB_LAST_EMAIL_KEY = "internly:last-email";

function sbLoadSession() {
  try {
    const raw = localStorage.getItem(SB_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
function sbSaveSession(session) {
  try {
    if (session) localStorage.setItem(SB_SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SB_SESSION_KEY);
  } catch (e) {
    // non-fatal - session just won't persist across reloads
  }
}

// Supabase access tokens expire (1 hour by default). We stamp every saved
// session with when it expires so we know when to refresh, using a short
// buffer so we refresh slightly early rather than right at the edge.
function withExpiry(json) {
  return { ...json, expires_at: Date.now() + (json.expires_in || 3600) * 1000 };
}

async function sbRefreshSession() {
  const session = sbLoadSession();
  if (!session?.refresh_token) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    if (!res.ok) {
      // The refresh token itself is invalid/expired - the person needs to
      // sign in again. Clear the dead session so the app doesn't keep
      // silently failing on it.
      sbSaveSession(null);
      return null;
    }
    const json = await res.json();
    const next = withExpiry(json);
    sbSaveSession(next);
    return next;
  } catch (e) {
    return null;
  }
}

// Every authenticated request should go through this instead of reading
// the raw stored session directly - it transparently refreshes an expired
// (or about-to-expire) access token first, so data calls don't start
// silently failing an hour into a session.
const EXPIRY_BUFFER_MS = 60000;
async function sbGetValidSession() {
  const session = sbLoadSession();
  if (!session?.access_token) return null;
  if (session.expires_at && session.expires_at - Date.now() > EXPIRY_BUFFER_MS) {
    return session;
  }
  return await sbRefreshSession();
}
function sbGetLastEmail() {
  try {
    return localStorage.getItem(SB_LAST_EMAIL_KEY) || "";
  } catch (e) {
    return "";
  }
}
function sbSaveLastEmail(email) {
  try {
    if (email) localStorage.setItem(SB_LAST_EMAIL_KEY, email);
  } catch (e) {
    // non-fatal
  }
}

async function sbAuthRequest(path, body) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error_description || json.msg || json.error || "Something went wrong.");
  }
  return json;
}

async function sbSignUp(email, password, name) {
  const json = await sbAuthRequest("/signup", {
    email, password,
    data: name ? { name } : undefined,
  });
  if (json.access_token) sbSaveSession(withExpiry(json));
  return json; // { access_token, refresh_token, user } - or just { user } if email confirmation is required
}

async function sbSignIn(email, password) {
  const json = await sbAuthRequest("/token?grant_type=password", { email, password });
  sbSaveSession(withExpiry(json));
  return json;
}

async function sbSignOut() {
  const session = sbLoadSession();
  if (session?.access_token) {
    try {
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: "POST",
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` },
      });
    } catch (e) {
      // non-fatal - clear the local session regardless
    }
  }
  sbSaveSession(null);
}

// Generic per-user key/value read/write against the `app_data` table described above.
async function sbGetData(key) {
  const session = await sbGetValidSession();
  if (!session?.access_token) return null;
  const userId = session.user.id;
  // order=updated_at.desc + limit=1 is a safety net: if duplicate rows ever
  // exist for the same user_id+key (e.g. the table's primary key wasn't set
  // up as (user_id, key)), this guarantees we read back the most recently
  // saved version instead of an arbitrary one.
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/app_data?user_id=eq.${userId}&key=eq.${encodeURIComponent(key)}&select=value,updated_at&order=updated_at.desc&limit=1`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` } }
  );
  if (!res.ok) {
    console.error("sbGetData failed", key, res.status, await res.text().catch(() => ""));
    return null;
  }
  const rows = await res.json().catch(() => []);
  return rows && rows.length ? rows[0].value : null;
}

async function sbSetData(key, value) {
  const session = await sbGetValidSession();
  if (!session?.access_token) throw new Error("Not signed in");
  const userId = session.user.id;
  // on_conflict tells PostgREST explicitly which columns identify "the same
  // row" for the upsert, so merge-duplicates actually overwrites the
  // existing row for this user+key instead of risking a second insert.
  const res = await fetch(`${SUPABASE_URL}/rest/v1/app_data?on_conflict=user_id,key`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify([{ user_id: userId, key, value, updated_at: new Date().toISOString() }]),
  });
  if (!res.ok) {
    // Surface this - a save that silently fails is exactly what makes data
    // look like it "disappeared" on refresh.
    console.error("sbSetData failed", key, res.status, await res.text().catch(() => ""));
    throw new Error(`Save failed (${res.status})`);
  }
}

// Wipes every row this user has in app_data (all internships, GPA, scholarships,
// volunteering, and settings). Note: this does not delete the underlying Supabase
// auth user itself - that requires the service_role key, which must never be
// exposed client-side. Deleting the auth user (if desired) has to be done from
// the Supabase dashboard, or via a small serverless function you control.
async function sbDeleteAllData() {
  const session = await sbGetValidSession();
  if (!session?.access_token) return;
  const userId = session.user.id;
  await fetch(`${SUPABASE_URL}/rest/v1/app_data?user_id=eq.${userId}`, {
    method: "DELETE",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
    },
  });
}

const LOGO_OPTIONS = [
  { id: "sunburst", label: "Sunburst", src: "data:image/png;base64,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" },
  { id: "script", label: "Script", src: "data:image/png;base64,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" },
  { id: "laptop", label: "Study", src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAEAAElEQVR42tz9ebS16VUfBv72ft5z7zfWpFJpQPM8IAk0IAESkggSg6BBCQgwtIndaYjbcUO8OqHjtFvIzmJ1bJIVYrfdIl4My3ZjS0Yx2GBsDJKMjUFoQEYSSEbzUCpVqcZvuPee99m7/9jje75yQncvkzhiiVJ93x3Oec8z7P3bv4Hwv8B/VJXwjncMvOMdoDe9ac2/2C3Q3/zdx+I9H+drv/dJvfDkR33J/qbjv75cxwvXBx+cuH5t6NVroHVCSUHKgE6oKpQAUgBQAApSsv9N7feSAqr2L/bFIAIAAdS+k4ihRPa1+TPjhwgI9jME/vOV/WcLIPGVApD9TAAAEwAGgez3k/+c9v9V/d9IoCAQBgCFcv12jf8lAPkvI4H/BLGvV4DIv44IUEBUAFIQMxDPJd97+7n9YcX/zh9FIK23hHj/JICS/wx/ZmhfFx8BESDqX6v1PBX5mahuf6f9oHgAZM8P9XpU/Sep/21+H0EV+XvYf66SPxsa9pmo/xcMiRdqHwhI28+LNwIAKv4lbJ8X+zfwAr18EXrpgux2xzzP7e4aZ+sPXPuX7373hac/jfHMJwhe8rxJT37U5zc/9Y1vX/AjrxIi+yT/qP9Df+Sb/41vOaI3veGsHQaPxNs/9JT9P/q1icc96jU7oR/FXfcD918BHryC9eQ6RACw+ocHKFMuAvvQpH1IscmpbXa0TR9LNT5QX8SivoEIIPLNiDwElAFVBZMtGiWFQkFg/wLbHXYwqf3TN2Qsylrs6j8/FrEvba3XCF9gSu2t5R5TqGouVPs5fiD44t9sYBV/n/EDqJ4RtUVAXIcStTcfXye+idoBYL/XNzcBqtOeiW/A/ug1P5f6FPLkBeyA8tehKvZeRAFiEHEdalA7qP1YED8A8iES2ZlO6i//4L0o2XuN5yRkz5lgl0qdMu1QEP8MfeWwHwD55hgqK7AqSBQ0BvhoBxwtwOULwCNvx7zlosq7P/DS3fOeSmcvfPbZ0au+4l/FxtcXff8OP/x1RG+ovfG/qQNA3/iWI3zog6C3vulMVQnv+th3n771l07p5st/5ujy7a/E7/8B8OAVnD34kOhugHYLdFlARyAeRLZgpr1gZqjYJiD2xSqSGxaidiOq+mLyhci1RlQniNRvAbshQWQ/hgAenDdMrB+VCVEBg0FMvqBt4RIAVYGogmEHAMQXMQiiijF88c9pm4MJwPAN2m5KiK8/2wh5jpFtHCbkzSciiKcDIhCPfF15MJJVRKpejTDn38VRA419Meqy8zrH7mo/gNWWPbM/FJGspuwZaS0s5bo5CcCq9lpgz9k2mB8A8ZqZ7ZlNAY1RB1UcUMyATH9VA3ZUax6s6l9H8TvFfwfzdtnHB00DmPZcVO2gierC3jVaJeBPi+yZqsYBw3WYwZ+zCnQ/RaeA5oSeriBVWh75SMIjbgMuH0H2Zz/Gt19+F1715R+l5zznvQCg3/HGI3zHc/FHdRDQv/2N//YF9/6rQX/lB08BQH/iH/7w/vc++bTdE578H+EjHwPu/iLOTq6f4eI5wvER0UILRL1cnFCJYlsATP/QqN3itnE5TmZqfw4FhGyjA/azeNi7nvu6/ZSgbNeb3br+OyhKTM0iGzpRp0kuP/Dw23yKby7bMOJ7TqfdWiC11xHVp3JuAvKvlbgV7fyCTD8Qhh185As8Whr7eVyLdAxb4HnZ+11JUW34exSBMntVUxci0/CDR+19SbRQ5Hdu3cR2yCp0RsVEwLraoeivKasg0Wo/QBBvR3pT4HV6PltrW7ySouHvu50rvNhKEG+BomJgrsMhDs+49VXtoBQBMdvGz+pv+KuzQ1yngHl432WHOfktYoeUVRt54kQ14pUdht86se7O9mc43UPP5lguXxp40mOxzuufVMVP7l7xwlP6hlf81wCgf+bHj/HvP3/Sq1+9/jt5AKgq4UfeMehN9gb2/91b/+Ly/k89Drfe+h/i7ntxeu+9p3T5AtH53aDBQ/Z70LST3TaR2mfB5P8+QYstZr/Y/Qa3DbOMYZ/tnAB7X6wKmgIagExfaH5bk84sX3mwLWAoMMhvIFsLCrWfCQXYN5FdX6DBXm2onQdK/nonINMWl1hlwIuVmjInsNgms80bP9fKy1zM2i5QrwLIb0dEOU1V2VsFotH2+2U66gDxKsAwAa0ugG2zMdt7kSnAsA4XcWBFNTKt4oqFXqCHQleFwxb+orxPHgRMhUjc/gxM/xwYkHVmpUZRQbDfsnFwsR22fq5a5RRv3CsWFcdg2C/4aVUcvF20g4GyfbGLwDZ9fPa8LNYOBH6g5Jc7OYYyIGIHfHZGfkDBq5YsQ+PPJCo9wzhoAHR0ZC9pYtLJtTmIj/GI24BH3go8cP9P48ue9Rn6ntf9eQDQt799wateNSlusX/XKoD1v/+7f258+O5X4sFrr8XuGGf333tK548YR8sOIsCUAuFUEkSz29MXjaqDL/7gWa3vI/ZbgvwQtvJbVPJDsF4x/t1vNaa6haOC8NvLbtgOIdiG5IFcGBRYmvimouiFB4gJpGILZYptbq7NCVEI2etif20yFWN4uS/qF6nVHKqU30sBiPnBp2IrntlaDGS14tVClu3ilZS1NWB/nyMW77DDak7kdbYsdg/KtI3gh4xgWumdmJnW95AXSIO8h+esGDRuTAJUyFsoZOumeTNbRaIdHOTRcAo7CHgZedvD20Eeww63eN1sv585WimvAP0Vkf+9rpoHBdEAJFqekWuxw0l1mEQbyr7543OuNkKpkEU7CPxgIccdFgZoCNb9qtdOdbn11mPoBB5z+z/Bs5/wTvrO1/3ovzMVgKIuoPVv//KfGB+/9z8/fc+Hnnx88yOO99cemnQ0BEQ76Gz4jzRwxj+kALOir4WCVDB1glSqRM83oX5bkqHj0TcT+0PflsPZu3sfFzcWEzUg0Evb+LDJfrY0sC1uYqK4egAFg1jtphcBcSxAZGuA/P3xHhWBpRHUS277OZqgny8af/9RLYDJNjYBmK1nzb5UCotQ5Nfa66asPuwRSeIMFNjJYND0KkcEyuQHLyUuEhVCgqH9FozbE3boRBMSFQv8dUh8PgLwUhsqSxXySQp7yR2bN8ptjRYrAEHyw1UweLGqoPDMOM3ycyPmet/iLVmCh4V12OdE2Rr6svWSX61yAlvpDzvgsg1JHJPz+UdDxAv7xpl77CfzhctjPXnwdHnVV358PuHRf2l57Vf+1OEe+1/NAaBvecvABz9I9KY3rfrej71g/sZ7/yZ+4yPPGesYk84gTBPQAbGeEmw9sZXq6pvSSkEeBBEF++YVf4i2NVfoXMHL4n+udbv6jUJTABZ/yD7kqiotkWEDcHxBeulJFDeT2G1IcZv5IhywA0jj9ogDwhdQQ9qjmtE5rSpgzuqCHI/Ij9N/P/sNYf00JU5A6ocCUW7kABG3JaaAiSFT28beO3pdBypibBq7ITaB+usenJOExOnifS7D8Qw/sB2o0CmghRPV1+mlej5btp/jeIGd4Yb1qBAwyG9yfyTMXp4LMAx0tIohKiryDU+tUkMeaipRnvs4ltnbs2h/xA6iZfEWAP48CUQNSG0XjbVmBBpk4Kv2at+BSz+ElPwwmTPXKECghWr9xUxq2OcTdSyEoIxJUwadTciTHj/10vgPx3d95y/QM25/UN/4RqY3vUn+V3EA6BvfvkSfrz/2M1+PB/HL83c+Ajp3AZNJoCsnxMzx4doHkMixHwAUJWvcEaQJiNmNMaE67UbNslFqs8BGMG0E3g4A8UVBuQBi/+U4C1QLO/rYmCxojOSiRaD83TmHd+BJph9mXmVImxYEaBYjwQDe8hAqDKXex2ybvF+KzLnB4kAItL9GcP53Dc6OAzNuZQyuGbtKgXkBmkkHuwg6GDTF+/Ua7cVoTEUMcEMVBX1MZ7+ibv+asnO1Sh3oVcq+X51HQF76W/tiOAcVacFbnOFgox32NIZXSnFzO8DnN3I9XwcC/fcR1yGWRAzYRRU3ek4VfFELFBQHcWAWg/IQh0hOsTQ4FrM+Jx9EQ3kI789Yrp1gfO3LgNsvfAN9z+v/sb7xjUd47nMnveEN83+xAyBm+me/8b6v2P3Mr30JeHnb/rN36bj5MqmskL0k2kxMBuJNdVTe/843ArNa35wYbJu9+jEraj2qlWu+AFhifzo5ppWaBAO3ouxn5LweAyARSN6g2soEB7sCpBvxcyTnxVbakVcxtTPtAJJcJDSqRM26M6dfNQ2nNu8PRF2zdeGcKmTLEq0Kow6uqDMNDfX23sZmnTBjk0eveEj9xuHWAqkBoz7fjwNEoy+O1g1ILoRVbYbNxAFtmz9Q88IdVBUks/gPga7X3spbNZYIOXeA2G5f+M8iUBGI0MaQRLbho9KMVo6Hn8HiYChX+2Cjljbeo/qstBGniHy8iAKtHVyGV2tKNcEgB/+MHkFFWPMKNA988VZA0EhPdkArFHLfA7p75jNopf237v7yD/8CALz7zW/evfgHfmD/R34A6I//0jH94Ded7t/yztfRpz/3C+ODn+ezBx9cx4Vzi56e5jhOHeQRVTCzA3AzKWJW+iIBPnWmFXt/RJx1sAFQ036OUEebpXpaOMqtDsABBrY5MMfcemMvm/NGF0BtKOwbrkZ5WSkX+mW8AJkJxCUmMCjLfCW20Z6PEsHVguQtp7ph5xH57eLgJ4Ht9tBAuAUbcgBRAmdx04oW6akTlYqm57cQ+fOJcpdQY0Y/GEms+gniTU4SWmuj60wsx4C2NtoTbEZ7Pk53XkDr5xM3GdEZ+wGjXlJbf51z/yD0UI3eZBa4R0Ea87FylOV2aFQFmtMDDIBsrCjrtM8xmE8OxoJ8stEruI57ZN/fGJnxJLgTuuzgVNY8tOKEIa0D3doeBS0EHB2DH7y64paLC47H9+M//vb305d+6bv0x3/8mH7Qxux/JAdAbP71p/7hd+DjX/w79IGPynp8NJnpWH0GDGiSVMR7PaLht4ydvpCZ8/PqJ23B8xjeGvh4h2xWr6s9XAxfuCL+4QWgx5uqoG5byc3G+fUwoG3OvKF5WK8qKrapfeKQdQmjRn8x7w/QiTRvuwS+2i5QJwnBe2M4FkqsVW1Q3TQ2vovD0Bd+UKBjYQUJyW90jcpkeDk+pwGGcZv6jRQbSxwl71UFLTVuTMDM3wt1NnGnHE8bIQa5SqndrrH6KQ7pqvbAw4sizd8JH8MWOynwjk7oC5agTV502jqxuXsxE6N1KgoyOXbks33f4BobElxEItX8kg1T0asXwwOCMCa29oTs83R8yIA+3bALraWYfnDb7wvuikpVccS9DvDneHQMPd3vx6ULOzz7CZ+dz3jyn12+8VVviT35b/0A0Le85Yje8Iaz0//+bd+9fOa+n5SPfXrB8Y7ANLDOfLHIWbOXlBzoti9EmVCS5HBbt+9lHcVcXtpo0H/uXL0F8BM90P8s74sclIeDIOfZwWrZagC8pOTi4IOmLfpeWWeLIkWZTW6AA2vs+gSvPAJf0LhlHElHDhq0+t52aGkHL73fFz8kKGaSebD6rFzIgFIxsC5agfgajRl63KBOhkkUPG51Zb85rfeP2yxHYN6Di485baP4ODZGn+TlfwdHA4MJnCDIQqJQmeARM/2o/Oo2TZxhMxVwRF3QxnXU/s5HjgsnfwTOpAyqcPYq2TpZ5WGMQxTV2XEI4xtMgBZvR9raULvkoj3KIjXYnRSaCXIeilcrUTGJ/btEy3ygzbBqS4wlC7nOZ/O8Pv/ZJ/qsx//J5Vtf+7P6lg8c0Ru+9Ozf2gGgb37zjn7gB/brj/6t76R7rv2kfOoLR3J+0FhlRM+dvTph07N2JFXU6atJ6EDjnBfTSgIo8fGYeOsw/EHaOND4ASp2k5EKVKb3uqUHMMAK4NisMGquTs1+jXyj5hRL1iSobHryQKEDYMv34kU3BwvROQxcvXDNo7nN2W0zxshYVFz7MLItivFcTYCi5BWrWmLK0A5LyUMNVsbHCM5pvKVT0CQFGQWaCqzMUYT1zf6FCTR2vr/vBD/EvBqL22zE/N9IWdkyieZHD+dQAD6KQ+EHhbHFnw/fONYWJqlJt4QfDQwl3rNstSAJsPrUiAPUleI2RAtQ7Rr55x8TLSltygbApXrmuab84JHQtsTwkF2A1sEgL/ICj5le8bFhO0JYx9U95PnPPNNnP/lPLq9/zd+NPfqH3dPLH/YL3/399oP3f/nnvn185v6fXj91525e3BGLsAFzPgZhKcS6E2WCaQdjxcmqBYZIACSaaGqo25iK6z04cAXknNUOaLaDYK41v/fLj9k/BPY/8xJNVTHXVl30sR8A3ZuiL5lgvpHz3+FjwXgNzh23l+rlN/xnYjjwqY115yDYqN7RbjIDfTjBpcYDGGQjvjY14IUdhJOqImZsZusn4+8owbuRLVOi+34zyzpBiyHrOrWIUeL8A+6MNz9gOvDKtidtZm+Vnt3yTpeeoahkG/1CwcvOighveYLclYzHpv5znK7Gcs4wDMAy27tVrAoKnEdcYBSt3zBWH/klQOzAp1C2PURe0UTZPqXRLl216WBgTGti/KrePsTlFnwSB4QcWKXka2zEaahLKCsh9T0GhSpDDaNY5qVjwe/8/jEtu5/Rf/zPJl77iv/x3cAfGhj8Q1UA+h1vGfTWN8z9/+tX//3lI5/7e/uPfFRw+ZhBq4vadENwSVpsIJ2BdvaeUm2DBAAnMkvt18rIuvGiCxYkvBUKO7virLIoTo7dgK59KbKIA0DBCqQ4xWdtTgcSoattpKCxLzGRkJSW5qhtzuL3p2pMUzSU5CYv81TXGi2lSMgxBn9+Ggw+p7xmF0tOoSUF82JYArfnHxs6RmezFIo1XiscxEZhNQFAsPGCq+DKvJg2aFZ2rWLTYkemfDfamVngWQJeUdlwlMTebq2x4agGMyhwFzQc06gNmb25tteiNZOP9qEqIoIExVgLwykxCaU4bKMs1VJDlrCz3e6u98hJhTYF62rrKy6YAPsAQkI6fVoSoCdVFWtriZKLAAV0KLAcKd1zv/LXvIyvvuKFL7r4ome/D299K/9hRoT8h+H001vfMNe3/dYbls/f93P7j/yB0E3Hg2SfBDgV8V7J3/Aa4J34h4TqQ+O0oyKRiohXb50kgmJksR8S2jgBYqW+6gRktd8zix/vQwA7NESb+l6TIjt8LqwKI7Goodl2MyBvByPHOI03pwslgAllYrDk7ICo2X1WJDoBNlGTBhLOms+P2bgDVtJq/lzjxrdbQsTYh9EmBeik9rwNgOvg5grRudHLx0aOAwdBAmIHZKdsD2Av5aPQyYO/cSZStBOTBw4CkXoL4HyCNuJNrUMwDYPJGbdtcjSQY8sQXRH7BGlKTmnCGyLVm74Ro0WlDuAGqum/W2S1NpOlJliIz0vac9LtY2lEKejEXFc/NEvbEQB3tiR5rohT3V0A10FtCRYnsoomrWcJb+14f0a45dKq7/4gzv0///ZLiUjxwQ+OP8zl/j97AOBH3rq7ftf9Txsfv+fv7t/1/pVvvTgw934f26nqjJe8xWjEaK5m5vac54Y3bD17jVPIEXH1g4Jjg6hTMbPE9pauVxfxoEJx5hJZJYXIapvBT1PmNi6MmzJuKFIQTbsjiDBG4/27xj9IHLF5QS6EicXOXZse61iqllFt86BuNtFk+TqzLKX4XiomIlySS5gOSvp/Wf2Rx4KVZKAlE3DYvJldXET+XroRhrUGBYjYSLMOGvJWC3BZdciSWbCxDaHQbtQEhQYlrlNsLPv5GnjQKGDPKB81PSH4gewjiRJC+pg1fBrYcYuaQrbP0io5kjUP4MJrikQl69wccE4+TOwn1kWsc9v4s41bmzI1qOn5+4tvQo0qTiG0imfikxvr3ARYvXJi05/oBLDqkWBdx3L01/S//LE/S29605m+/e3L/18YgL773Tt68YvPTk9/8r/Dhz61p1sv7uTkBEiSmG8GUj8cvd9TSu46iCBzLbEAN3aaFIAmXurGDJwDhYamBoCjhAxFn7jMhwhjsQpBHFknX2wiYgIhKLCqiUhUfQIR/Zf3kgqbt+YN4zfktH4vSUVTU62Y4g8GCHNjLpFjNe/HbV7uGyCnCuzgl5Z836cfGoITp9GKTLBTSUVHa60kVYVM5LPwWGCU2oEcyaqaBsvL3KQbx0HM5LdeO+AaEYdDBSk1VVDqo2wXwozo+7kMRKBplmQ062p9iEeSlqxd6j4FMctHvk+VcvlRl36Dhx3iojl16Ah7liiK1Pv7mzaGYzIyA2+gEjqhvAuskrD+koJYlJ/BYrwVZyAiJkJBTw86etKv6+An5obzhNmLH3zTL1UfXbPjLcoE6Ao62i37B+/f7y7s/pv1p956kV796r/4/3MFoG98I9OLX7y//l/8jR89+sQXX7dePF4w14bue78NdVqoJHMrQKco3XgZ2QqkPZVJNZICat83nVHmJb5/BZFtRkmSzXRSDyUyHYuGyU9Of00jbnci0NDUuUefaCeuEYco2VkxgZLS4pNLZVXAS+JoxtxisfKeNMHLnP6S5O+BCjCiTSliDHsJqSyOZdjCZdXGFgzOhBN/htuQhXWZHypWbodACdUOOIPNzqXVb+5q34zJ62CpIGm+tLhgaOHCZYIuHHJtr6JyFAv7Pk6uBSfXAQNJmw4hFLsEG9Pp4Nw2IYnf4q4XEas47L0XlkOwloCcUm5y7HBOklyXiNYHDbmP90Wh4ZDCJ5jyMyQxjYiNsFHgaGBCA75OxbUQRdlW7piO7YP4TAqCiOoAOUbNViHGoc2HQaZAdLWxMzH09Ax88dxu3vm5s/GxO//C2fs//DX6xrcvB95m//MHQJQOpz/363/t3BX5L2Tu9yqT1Mu3UtBJgO6gxhKz5zL9A7IjnIch4ZS02CqVg+NPKuAwx4gRoLr7TPRfc2bZZW2C9YXi47Q4hMw6zK3Ehk8i2MEyyOYWTgLOKO45j7jZ/NAZnMzAkBTT6JRVH6t1wk0AhTox58zbq2ytQrhS1U9iBowk5Ij6gnNikqHKM92QlJqPgQNN8cEECJVgJGxsyDEeHEG8lrDHMw4EFVbA0ToNACNGsA3gbBaBGquKtDH/vEcfXp0tlPhBgrhu/lJyZ4HS9GfuIGscDk5uSk8ImYk1qApk3dsBgcI2tB3uNLjWRGtnSGa+XjSlKPkkRvyQz2eCpmmI8Wq8di6Vaf49NVe2ICNIfG+M0P3Cg3p71/YXlYlStU92yZDYIYDTE+ilSzv54If3eMsv/RV606tX/fZvH/9fHQDv+JF3gN70JtFffffX4wv3zT2tI9BdSSJIsUtDUy8z3Gk0SSMqK5TmZoZOcRKqj/3m3iwzmfOWNRqmeM9rC4c5SBjIOXtq4MluiLi/ie2Dm6v9jjEIWKf/7KDp+nTBy0txYAks9mGz5kEQ3AU7MFCLCrNmz9xmxVS6Aw0vsihrKUg+s14HSRmLDC/zvRVi3zDmcyD+TMPmTLfEqlFAGHlFoarAUPDiaryYfFDv5VtVFMQstd9lY17vcUXyRkz6r9ZrwlK2bGkaGpJvcpedGGt5FaNztQPNK7Q0g/Gb3EZgqOoqxF2zNiicXwC2qszwKMcKotxe2Kofkc0OUO/doQLs9/lM4r2r6EbWi0GQ+Lv87GxNm/rPnolIgXnq/UoCq+mkFp8p8jILDoTtznCYqso1BxU5CvdqzXsrOjklven82H3yc89f/9rf+zl661unvvnduz8UBqA//kvH+D9/I67/8GPfcvyJ+x93dnYdtCNW0hoNUTj1+EkUp5mDOCRU658U7DiBSko+/PbdlzFDXH6Lj+TEbuFg/yFMJvjgphRp6j9/kAsSuOKhyR0gB1HIrXZknVZdxM3n+vEUL42lBBuqmC4hBTcbL27KQj7gfTtOQYMBXmwMhS58x9a2S21xhWCIvYqhHAWpG11Q3QAhI+XYtCU53hKtoj2gvJGDfmx8BDTyTbD1Zr3XeEb5XhtVmNUnMI2l2A0zvaooFqPULJzCIIUStwk7tnTgjRJdtLUZ5MDusBvd8ZuAk8OtKXkDVFwOlT0wOZ2HAngkADqqlCHXrdjzn0lPj1bOCGfsn/Wsjdv8RJNr4B4YRLTRcVCCfJJ/H0SsZBCKb3byvYEaA8bImFLXQm59psDxAN7znhfoL33kGH/+x+ThvAT44Tj+Z7/42//luf3y+v1DDyy001FAk5dhwXLzRSgStEZNTbnCNl/2Xl6iSYymRKr89v6OQm8dghbnlwMC2a8unmD/fZIfBlGVeeQfTI5eAtwSSXGMTGm3pSTD0M4h8jk4H7xn/4CSY18VAVF7n2hGIqom9ginH65eNx1vou2g2EjT8QAUViLTb4BZOv92MGkX2cRrcGDVWglnYFKh0il/Je/73TYMLDkii9IXyeYMo8yqshDyWvYZt8Q42Hv22A2iTVO/2u0aoO0ybFWtPkEKnoZoWPR5vwyvCJAHKJFA596rA0PIVcolOgQ88IozCVvDOf0i+T6UfVrSXKbtc18bo9U/842rcdzastFwaBsTsnsyShjC5iGLFGyJS6xjPSfRLQhwwRMhq75UZwnU8nMPA9bJc845RJ4q7/6VX8S737zix3/86N/YAqgq4d676NpH732C/Np7Xix33qt6vEgfs5Rm2vtoapJNn2NqlCuUersUW6QFt4NaiVILSqCiq/PRkSCWNOknuRBIw+kmbsxgofn3AGIbmsSAIWfwieMCHH0gS+EFIPCO3Z1F64Fq4QIUHHzWUhKiyWM1pKphiGGnv6x7q2R0OuKtOdaLysHUa9G724LUYs1s+eExvhxBHmI3zfXXOWA+hK2y4m7iaXQ9x2Yo5/PsJW26DXFxBcKWjrlmsdRGjzFpiHFYZS9Uv26MTMcBIKnJILY2JVsMWZNSreQz/2gZdK0hagrwprEYc4Y+bZOTAtPXAsQhGM55uo1yHdz2kpoWTgyBwlewHZ5GPJXEZJTK3IXI12T4MDrekt87UBUzZOun5Uw/CbyIHPNpbVHRrv1A3ndlKKcFmQ6GKFjWqfjs55+Hf/7eb6Yf/MFTffObdw9fAbz1gzt60584me987+vPnbv1G+d9d6+048XWiy0CDm59m5OqE0LIyRIUmymZUZQLwDg0VIBPEFw0vnd6ZTDTtptDMWV1gBMm3LSSDZghX/SqdhtxcKxFmmmmFmA1gLnuXVo8ytFXqo9LAkvcPrBKIRdGlGuO0KbDTWycZhpJY8E44swSqIQNlxPr9D7SKKpwYCvGpOwOParkFUX9NwM74jX4HNtMSdxCDeWCk4wLtkM46NMEQ7mz5x7Bd3Agzj8j9k1llN+Z3wt18gvE10IYqXaBlpZVeTATIWm6SlwEsiT2iIFzmCtkv0/mHzl4HNTpNG6J8BZuOgdaHannDUgbpbcG5VinXzhVsULU2aVN9OSj45hAUfIsNPX+kQshMTUINp8D3EhWZzwrqnOG4qDb+7hxS2ILZx31Cs7wHy3DWl+3LEo6aGUed8gv/er3q+oR3uOXfT8A9C1vGXjrh+bV9/zei8596u7Xr+//yBnOn2dKopRtFGjIJGP00noYbj56aaTp5bULR9hLRJG1Fqs4okoCWYN2Lz5HLVONqCCsJ5NE1NPYE35QDN2aSbg9sxFjig1mPds++0kGIKSYjnGYLFxcmhDElGZTFzP1YLm5WUmx9mpRda+OBBIDoWc0ui+VvRlmVlJ5Y3KpD+EbU73NIK7hYxmXEnSUk3H/jJLEHOxBFegwmbaGhXoQuub0sVXzEGTNFirKTvXWLERcIIKQQshbLmibmGhyHuxWlgZwOd3YQVkNMBCVnRBtFxIgZhCLy2zRKN/dAmxWXgQcoHbFYgjBaNbmjxAQHcGaJOjwA8LH1qFK1agQqScQoarTIIN5e6wktg57eJVPa2hwjRzzEioBUWhscuLljtgSYKlY1QNV6FgWufrgiuunL8Pf/6ffjjd//4qf+IllWwHc9xSmt75h4l0f+coFR6+UsytCC40wvCR2iuycbhxZaTSGtnNJRqkJGqQeIsX/a6KYcv6hdE2NBULuYxcPhsNymlq5KXADzhVznhkZgqlJXxnkBCHaLeYQA1sk7Mw/masdSO47N5yMYeUY+TxdfXRWJB12EIbixgpzEm7/TB/r6QKakkkTlTCIluGLRhOMU0bzIPQKgSZkXb2UrECTvP1IjC+wEHg3wMsoMUkPtxiAkB+K3s4gzD4DgAtX20HAMkC7Xd1yzXiTPGgklW0ORIUrccy1kWKf7cxdYMKuPBAWc46iRqU2Lwj/mTEB8N9hm8onFcnqkRr1poq4qovADuIAtmdQNl3mIap5uPXpTsmZ3dl5cEtzaiW7H6LcfCbjs4oWVzfIvh+cHWPx/0sL+PRXbPbxILN/p4qeCzGVcUlW0mVM1nE7/uGvPpGIFB844e0B8J6fsP36S7/5BXz4k5MvnqNQiiXPGXEjcFpUIUwUQyTi9Fr2ElYC/Z9rAmEKLUtnUfeDSKN/w4qY0kdedboGgOFGMZizKKOy2gMZfrjIKlmimqsO+/gHScax0R7nE2DVjRuxSCDWDoIn2Oeqt7QXtxYkaLeZVUdUfm+uCqvRYzME8Vvb6XD5T/IYNBHri1P80/gPNtrjcjb2+z9ALFln3pzKNSVJj0FKb4xcWBq+dSh9AGKTpIGpFgsUgarP4jeQbvwMiGEmLjLza/PvUggmaaiClFU3fYP7RISZfmxa26CrK0G9tRjsGohZE5Cw7E423zTeRByiSSOWBHg3mZKzUbwFjTiEdG1OC7mp7aBvwim/UNBShdDzRKRCXnSdaaYSKkK7S2SjGuTwr1xnCaLKicAOy1WAZRzh7i+c4o47fkD/zj/4JvyVHzzTN75xAYBF3/KWQW94w/7qj//8yy584cpf37/3A1MvHh9xC2TMcjWlmMVllpjDBrc57ZK11HLsCLmrmNLRhbpP8/akNQS48Ql4G+ZJbhGdNsxxs7AUrTg06ApHcsVkxMNAoKS6O+9dWoIO0YFWMtlelMEdGJThF6S1Wa2nz2TRLOMCFOy6cXVmmwmPpoONLUsvqMRwj/rBznLU0r9PSaKQm5e7Am1vxphUjkYpWpkOrAamM0JCbb8jKMRVfpvHHrlRhn02VJ5168xEnqjUVKdJg8nyDUh9UYqX7OHLmA5GgO59XDZqcgD2bEYyWW+YsfbnowGkNt2/TRsauEc++I7enzjvgZQKh+NSStol12ZpVqxqsgJK6u+CfMRc5quRDjS1OAfih8+qieILGmEoRr+sznp1mzV2TwBUAIrZLgTz0Q+0oC/LNN+EVWkOxljlifP9H3z8AqjeeadvzbcC+nZdls/e+yTced9tdDyUYmDkp23qomMjiJYoJ9l0Url3LvQJnrnCqoIwgyg1oCucUEIKI+SsXtqLG3d4Px6gE1v/NX2kEuWlaLkKQ318NqLfd7CQAFnLkTV+NXzmqzq9fPVby0dScWOFzVkIgYLDkHFeflgpKrswDspgvCXQGXTVqBRG/I5yIO4lIkapIGP0U2o72xASXv4U9li16VM7EGU8N2wlLP1Gc66A1NRisIF+blaCpLba6JIGDH+JXMQoUbmcm7qKLxx0gmmJ6Hlh6H0i4aOXvp5QSs0rYXCetwHaKXSTDQtuGYRhux2s0vA99OcUNnCYXp77iFhncSyCO4Fgi2oDFRfeCNLyOVBXBfrnvRiwrXFwSjE3DcStyMvQOsRURluqVGobtNiLmQ87HOs4f3y0fuyjgptv/ktnH/jAV9BP/MRe3/KWYb3/8oHnHj39CT97+plPntG5o+MoFzFaeMNAI2b43J6662ObrzrHP5xqkq7q454M9YwUIK8sVFez/fYFHOaa0auy+7qbLHdmPw2ScuEJC+mstsTHYlQfytBNoKWdtNaLhzquFI2V3qtUykdqFuEUs1mpTMBkbsVmJWoj0Yoly3Yg+ulR/S95Dx/JRnFDBQAHDm6BtWTucJ23UB6GMRqjFk7im9tkz0Vo4oWddBKqwFEHytIIWy5iCh68ppgFuTFpxw0ncDUbN49Ed26Kqk7JswWi+uJGAmojZ8oD2Z/dgkZEKwwiq65oOYaTyrD6QeIakJhOcMmcFT5rb9lGmQfIlFiUeUnsfXLCqbbstuzRKgWIC0nEL3zifM3Fc49nG+rN8oCkxgOhGhmkJBxckfNRDYEUrEq0jLNx5ewm/IPfPLfBAE7e9s6r+NBHBReOaEKhC2MjIOiR1EGVzjFbj3xu8mBn2pkScG50+IBgegzV8IeVsVRBhlHPU6SygNJG7hhsUl2ZFbW0yaXjcvqJD82oydWbhz0Uk5XNBqRUBJm6hTYxstUZo9E1R6XPQM2dJ4Qb5CISh2lSnJMmlwunFJ26GYe2UtFB15jbh6cf75YyPHVNQjrvBvgWQJ33lhLtS6wJ5wjQYGAh4JhAR4v3q5KgExZ37OUWetJNPQcBzpsIcWPiFC520STPGM8DPi0wPn61M7S47yGz/UwVNxol95QsXCks26J0T8VfjBjdqhsZoOokouF05NUPnblvnAcHJl1xN3bDDTykOSF1Yr42h2tNrCGCVYLkxsuAKDkl3CuMFmgjaV7hLE3/7GjYJWBkoGGfbdCNBxf+knhD3MXaIC83Z5UVeuEc43OfB1+7/1mquuCDH1QGE+Sxtz8bX7iP6XiUJ+agCtEgzcWnDaMMwoiJK7jdfpRZfojxSkuv1Z7K66GdaUdNkUI7oXsjaMSHT3EDj5RhuOVX59HH9MHHfUkRnkUjjTBIrtmzGWy4FTRXmR3o9qYaYjKWY7jBQmwUE+NCR3k5T+uZ1NAUyYSgI0ZUrPU8M1pCtr4C3Qw4EO6chTsgq1p/NwA6MuScMEHzDENOQWdXQdceAJ0+BL12H3B6FbQ/BemZ6/ntJuZjF5KNRg+ONoKDnFLVGshMWUwsJMUabQo75cjEq4qcFi2quIuTkluQys6aqiSXggzbkQAKM3BGbPbvYbMUvXQ8Wx7ArmEMkd5ENuaDVm5kApk67dAOW7OY5jD7dMKFWBALpHU8KoD0IA2RtjwGjup6eLXaXIqasxS7XBw5ESpM2/CP4H34ocEV9JIqVhFgN3bz/nuEbrv1L+L3P/E4etObZNEv3H2TvOXX/9v1ykOKC0cj0MNyNPW4rpXcQz58+aKHlvJC4yrZOQIrlAoV95Kep5tPikVNsi9omWHNTT6DV+h+n4dReOaFz58dLEFdtZgn2/SSmmpm9nahNPkQBe98Y0tZhgfwFH0q1JV6S7p12jiqp89AgWVkHLTbE/risXmuqAE/nONBdzcaVLTXGIPGTeO3dMSkAZLz51S0Bbvb1WkSTrvD+fjrHtjvwSenwDyzr12OgXPHABbIYuNAjB1YBLQ/AfYnoNXeJxYG+MgxEXYlIqVPti4RfcZlgzb0wMXZcYPBDq5xEYHcwpylClJ2EY44ss1UX0fOrNMpSQBDd5Dym9REXWYPrzNaCa4kpDiYFmOtJdU9Nt5CRScW2rgR2diywjzstvf+3clTogF+2+0eVWZPdEbzMeCIIvMXqzHmndqMkMULFS53rFQHuwGKewuUK7dnJuhwNqTS3C3r7r4H7sCv/PrNALBc/clfu3DxyunT1gVCTCwibqarfgs1eaxMaJR5Awc8/hodbRQHPNIDnZI1p5jiLD8PRtAV24yAQIK10laSYLMxsVTwzngINQ4x5WDIVtk3VSDcxd32/ihGM6t9uFZ2zTyhTdvNeVsHwdvci9y9JxKGIw2JBZhUPvWh/+6agPB7D7acjjzFbRzkqL8DmBVN5m49gw36EAfTjnxznZxCxSzi5fKtGM94IvDox0Af8UjQrY8Cbr4VOHfs82Pjl/J6Bv3incB99wL33ge961OQOz8Juu9+0PU9sByDxg4YizHzBJm2pG2SgFkgnFUSBJ2UVHFIZAg6h8OnL7wsBbY5VpRhJ6MssZL+7QAk7wZ0X2M6mWvmFzJ79YrijwhCSrw0JWtNaiInsCzOLKhEM7U6osrdAn+VZCbK1MZr4doDVJmHomXRHtVkXGpzllhMmylxAOy0Y1QmbCVE51je484xJROaDRMLe74VfHwM3HW34H0fehAAlvW3P3iGm24SGguU1gTawoTD/Olm+fNzC0x051j2E7N85amVaZpECJlavHAtTEAzTNElvPtZPRA1g8UMkNTE1TiMOlOiKnmKk0t340MP66lkhg1ORxf4GA8hCEIb4+WiJLc4KKdYdvwiTDwMBbZSTZmzuok5bt7yThdNz4SYELQkWZHyLpir8zDC1HP6dIMA2rlR5vWr0PUMeuFW0HNeBHrBV0Cf+hzo5cvQ3ZIU7W6XXbwOgJ/wdC+JV+DsFHz9IejHPwx9/3shH/4QcP/dGHsFnTuGLgPY7x1k5KYSbVFXEfLpIp0gwlhi73AlWzEKE1wLJ1efCqVqT0t4k+lL2sBqCfORNpMfFZgi0jwSWIFm2tFVkxSLm8KGy1sSv2WT4BZqvrjgmDZ4WGoJ/HIy4xvaaDvSoFzYcxG0bNyIN4FD3RG+iEsFhqa8eFBzP6o1pDKBZWE89CDLN7/yP9Nf+B9+aDl+yqNvwqfvZYEIpYJHys01/LXJZ34TZXoJO5VknYbYOSkmHPOD8hl94BjkknKn5apnvUe8lGhx2seNKbiW425orll9UdFwFUl6UbUPNxx+0/AjSB5hBhIuLw1htRGPj+eCHLOQuR7NZrCRbreufGTL13MStnG45wrJKO3m8NpFRF7t8PAwlJxxk6HoftPSzj/ouGVGIO8D2J9AT/fAbXcAL/lKjK/+euCOxwGLgXpzfwJdTyC697ATAgmDaWCgxW2lQ80AHZ0Dzl8E3/Zo4Mu+GvSFT2P9jbdj/95/gXH3neDdEWgcY+6d/8/NzVnL0ko8WzFdj0NsE5tg4cyL1PAxJIaufkGkv4HzUdIDknNj5z+ZEnMCeRblqsnfyJRgagEmKLJSTE7qshuFXWSwi1YCUc8i5GaaGnZ2i88wZwGFNZmMUTqlQarZk29T0VN6TVpWb1RVaZil8DLK3iwnCGgx7F4F7Xjs770qu1X+FN73r99I60//sq6/8Bvg81xxRZGnlr2RJPOo4uXKw70cwDV10UnDTJ1zj64qXnj43dsJvtaIkIdrAeK0LddfWpCnXzL7CJjTxSpuSErRS41hH+pcK7IqBC1xig4UhTgdfLsruS/QMbIkhXPojSBTwqCK+ZakTEcwZU5EtEaTGaDZOfrOwIvDND3i4lP2FB268gD00mXoi18Nfs3rQY98jHMpTh0hdsyGZvWTMAIT+z8rkstBcyrcJuboPExJOu/+NOavvA30W+8EX70GXLjJo8Hcs6FHbTfLbV2bcYqj3FrNcMZw5XuOTa1xS7rd9ro3vwluoZ5TKzE47cE5qzeidrXHYo1KN3pn72Hr+7ba/kzwDUwmEoXT/LMmZ3aJMHgs5mm5elBNw7EoUoHUZ+DhDDXL7EOVagipxZLM1xVhIuGD4RbzseEzqlzaZXx8DHnwAVme9SzGU5/0qGXeeZ+pztokSWfNRoMcYe2bFMDEqBs7WFGM9N6TNIqP8QryYIAHGyjEwDg36FCKHHjy1gLpvmOhD465e+AHXFOu0yqBsZAn5VhpNqeApisOyM01XbRSt0XEX/mpTa19kVrIJgoBhvN6TW7aguOa9VX61Y/CPExtNDNrgBZPmOUCIxPx59KKY9DGh54JwG4HPT0FnVyFPP254G/+HvCzX2SU65PrFbEWsVxq7La0Wo/S0sddeTLEKClyAdtBIKfXrGS+7XE4+mM/iPmcF0F+/meAT3wMy+VboDwgc5+3agSCKDS9/q39GkUVDqm3FEhsSU2UCLuuzSFIIhFIMi3PjEDMhMY+15FEoTQZ8etbex0dz9tHztZfy6YdsLQlE9sg7NaD4BY00rj1h5uSJgAnwLq3jMkxrOKYVI++kZQ0TGq0p2A4xjVXL1yaqWhaik/EzIRcHg/3V4BXBlVSuHnVfoJ2O+CL9+DKlQex8NVr29J7Sgu+DNkoctyXWW1aNsnFizfHFyI2jzIP4syIpIhYosYkmwBxySW1paAkZROlErNoMAdGfOxiD8OMOpKZGMitM/yYnFgQJ+9QBw2Ri7bTkt0FzktJz4ufeyfl7TMUIhdzpti2OXEyLbi0/p4GQ9rwFK4oKKVyo7F9OBu5SaG7HXB6HSp76GteD/6GPwZcusk2qEdis1dskpRtLlCuh2X0QI9KwNoq1KTKYZBC99cw9wT6spdjPOHJWN/2k9j/y7djd3wZdHQEs4ynppw01SQnY0qqxw6lpRaaHe5pgXHUrRqpPDFJUHB50iXqnjGaLQuyeusoz/P4yJFy4Ae5+ZgACXWpJngcGaAIPEra6Dts6ty9KFH/JohKJ2WmrFIDJCYiYOe93ZS0Z8sqqpmHVKkvjZTlnBm3wC9HqBYy6d4ROF1BcsSLfPGhSjJpdWDcxpZgW/1xmEFUFJWN/PJiIa8G3BxBfESRwJ9On3ZY9p2s06ZLbIg+ogrAtJsD5okHwCYHLU+ducQWRNIEEyUjzptEgvlGTV8ddt+OVKM89ysvTiu/r7spcVCcOVlt6lRaHqPMUTzFWKY2FV/Fg0NXmxYE6chjqDV4EYE9iYJ2R8DVByHLDvjO/xPGy18HOjuFXH0IOD5y0DaclLFRkoUfYYJDkYGH1nZkepMejKpaLoLxsjGvPQi6+dHY/Yn/DPtHPwGnP/+zOKIJGUeptgwfyLRzj7EZyjkKjiPZZqKSs8Yc3EfJ4iQcmyo0y3Q1nUEGsYZaLvAcNW9pivHY5GwNrcrcWZ8vlJcgD06rDmL2zYiMpo+xrYWbGjbE6dEwEZzuSPIhZ2ZaS+MATki91XUCXvKTr6PIGmCnVqaXBZf8nZqyVCJjcVAlYGWMmRuZMhvDggcggpN/8o+ujT//3Ff+CM72oJ0DHNzYow46hFClshlL9pumDdw83BtdKMZW0jCFUEaVhkgDd/SRWDD+1jzeo6+WdfXAkEaHHAV0KIW9dUiNuYknCn3VRuSAH0BBAe2RzmGXRWGg2RKBu9NuRnUPzk0UGXZ2i0qFarh4iLp0NXK3SVuFzlU6746gVx+AHhHG9/4Qxsu+HnpyCp170O6oBVeWvDrlXFTcheDsJhqNit6iVnwSbc+74tJXeYz9GRQDy3NeDNx2G9bf/S0MsRLTynEunIe1OE15CKH4HdwPnJq9g2jDd8iE4eDy9whwv7lrBE3VknkVRiQ3IPSBnqeHhJS7dKQ/pfAlM/7Y8Alp/opTN5z+oHSB4cKf7Xuojd56/cCOmvtTyLQzzRiV+VAVkG/4WSGl6KnOAYB69cLrSkd//Lv+BVP0wF3+2sQMIlIJqqEBCPkjtGnNXcusKPmoh2lEOWviHk5WmaCSgmIDpppO3JOeNDX7imk3QPSIpIkMEyl45wy5Ub8zbKUPqvviuYdQJYJLQ5KrM+m78TPT3sqjnW36sE/uO3Pp0S0rwG4kgTsJcaTiRgaAVovB2qYt7txLE8R7YLcDrj9gzr7f80OgF/970JMrhr7vjqo9aoEkqXXg7QRpQ/E+/N8bI4sebnIgXQ2Pht0C1RXr2VWMl38Txvf9kIn/9qeg3UjTkiDwxJgwQdFw741gFlaL1UpxzgrZr6ZuZG3tg2QiEcfYj0pclL4Ew6oL8zFwN+mlwFV7Rntz+OUDvQhm5g6kO1fX/UMh+7OyHmvsRMtCrbg88yCoyHCioo/XpyPZ/tiIk9JVOTInUl6eFWrtQQpgsTFHY/yosZajrjG7bPCF8/8By7UTBzY4AzVjxKQoj7+wNA4xTzClQkG3MU2c8RCluTkqzGRXNsk1QdENTrWixC46rWRlJ8NE6Wp22qXkCrNM9HDR+Nrg0gdnm7suP6it1h6YHLeCJBL551A5Fhc8+Oe0eLnfZzcU5p5BMW6yc7LFkLgIp8uagVkOTNprEOhyBDq7Dt2fgV7/fwS/5DXQ02uZKIQYP4Yqrek3inVGPWMykfKDEMh8HdpUZXHopQnpZn2peQoC2J9cwXjpazHe8H+AnFw3shCVEUZWk6lG9MtlGBFKMH005wS04F4McZ1BGWAm/31wUoXtQK91Ce48/dBIxJpyO7n9mhdf4g6BtThjtJyQnULutni6d9+GBlyCXQNAVN4Ns7gd6j4TmXTUcw0z7JTzuWWl4kIzm5C5QjP8NUQruCQnAmVlXunTPmpfJ2gwzf0e+sCD380429tfc6HZRJw+fBxRUEHAUKpyiRlTp6G/QX1NCyR2Ec2EzLM0gGTEm2hmEyouBJnpKFPTIe93eLhKkNJY0SSa040xyPztZE3vuUz68VIxDgyQVLk76gZUBmQE6y8Ud0g6MEckGVPGOFW0ufvnjZZRzze6LxpFlTMai0jTI67CTMj16gMsClx5EPq13wZ61bdCTq77SGiUvTjKe4G6J7X+T2RBkx78fcuwe7gQ6U1ZiSwDgua6sGLdXwO/4nUYr3s9cOX+qsRQz0fTN6EqtySHxRRpQWlDMpCl6LjBk89X3IRp6bjjN6HsV69EaeNGlWGh2kaDARyGiKjZn6UJaoxnR3vOiPfA+fmnXmhQ0p9pGWXdHRqEUerVDtSaV0L2tPY7pB6+RA5hXNbRcvRMitY+E8drKV/PcXZ6jjfxSgHAuXV32F4ZL9tNE6dU5ZEOKGh6Z6TRo0yTw6ZDUA9NCAUd06afJxXIuqaW3EYhUrRNFScQCTCkqZ7mDR5wGRjKWvbWVPwEabRPsQwzY4xNcVCmpLkGYs20Nkf2k35TRKU0V//w/TQOJDcssMK0MQC7/eoSVjnIOHAA6IF7gOe8EON132u9uaw5SgNRjosCJEpDFm3BJH67UxPJq/aY7vZnWlbqN2RGoPpN6n/qM+chgkkL6Ou/B3jei4AH74M6GckWn4/bAuH2jDt0Wmy4Og2pUSiXrVZWFDnt0UyGUlS1FkYp2VqF8ag7VKFxHMJHIUfbqxvHdNl6RM5JMzZ1ApEBgWZcqqsk2Gten1SekhqqQm9xwwQlQ240wWqIOT5TsigpnbC76tXIo7Wpq/rwWz+MpvL73DRWFOvZCja2nGzy0HljoODgVaSkLlonJlaM4Z5kwZrRsoQKL72NmWbkB5Ck4WSim6rpOZdjMbhHG1XIhERSDRHGslQ5ymGs4LgGuUW3Gf6lz3vclkzFymOnm/LCDvwV+5Fgt7SI25NFealGRdbuXhMOwv7/AYs7C2fieM8mZV3L3plKMw4R0PGAnj4E3HQL8C3fB1y+FXJ2Aiy7dIPpYZzBo+hdJVo/X/yGQgSoERQLO9y6FiUYhwp7Lce6bcgxMYD1BPPibcDrvhdyy02g02ugo10FwGjpgdLyK2jnKBUdUBZd7MEb8OcV9KiMBoMaOcz7YDR9f29bsz1LVSAqvYha7Ppwc1C0jIm4tdMHo6K6w6g3sIr+cynCVnwiI16hBn2/uB9a0Wfo2YGagCCh0X7ZaNwZ2JLGIM1LMUbv0a6jVzKO0WkzG9wwhlBOshxClDGMpKMWSqiRrBPEj1H++DwIg4r9tEmrVRQq3hxuqfmoxykVLLu0BlMpv/tkiUmZJ6CinwF12al/GC71NDmnVGzTlJKfuo1zOBaFJj/89EISjfCWC+lqmEFyxFE5385zC8pgJailzuNfOOXMabrCbue0vwJ9+TeCnvIc6OkJsIxyzG2edAHRZe+O2sCxaFQPIshTD3CIGNMGH8xDu31PJNz2bkFbBJruT0FP+zLQy14NPbtqm3c3ClPiVrG5jFycBaptGmOlth+8kHLmTUt0TXzCXq+Hh2qlTlOzl8vePsG1pivQqqI4IswCd1q4Of6g/AaD3efIKC+0jWYbxv0I9ye7sNjlv5regNSi7uOi4FFMxfQxbKraTnFXB+rT/j3s2ELklj6QmmszyjmG56IzlTFlbFI080deuCTYcbNuxmmVYhIZ5yaeEdPXh+FkrMNIxnWvt1BVBaBGC7kTsKBFom3imw1NnX6DSyalhOZc+UBtJy2nDuUDQL5wkvYcqj3XsWNGhJixxThDTc1HP3PaIvU1NfmaRqhBagoJNUab2UYCbdiuLQRcvwZ97BNBX/G1lnU29y7eqYtMmxwUPaAVuGHWnwIuqmqqQkz967QqhrCOjzRi7W1GHjxthOXkJgYZ5VoZ/KpvhT7yMdDr1yp+K8fGhVtoavYl/fZSLUkwB5/27GiIOS0HZjSaCWfzUdAI6fQLIhOFSVpGg4NpVNF2aMI3cYEZjx5dVpOlYLpSGndWopI2azXKSs8Pkz51SO2EVPKyryFt6toABnVtztJpAbY1DC1vTWdLuj9myKcjZ5F7OGQEUIqXQkxR+grm2RlEVttwGnZfETYZQJQDGJ62Mvf7CnYMVxYCxvAZKpfiLg8OT7Xp0U4mzpEyJA3RCCrWKU47kXZgtZTePGHdjFKbAQe4KLJmp03lwBofNrC5cWzUZ0rDrDbiYJCJOfcVKBmAVFNABrhlcsEWnjGsz9d5DXjBV4Me/SRgf5YU7HTDaT6KtB30IalOMZ1QahsdudkrM6HhANIyDfphUu5TufG1jQvTJhye87Cegh75FOClrzJcZEqlFgfgN/xmDqUla8tlrI1Erk9RXZ1foTnWSiPP3JxuMKLSAEMtTcooph6xG5OoJuAdQSoJ2npcml0M0wk3Lbgz1mL06ygTnUg/5rz4toeBhmw3uCJMBwBeiKy0XH8jvDVYk64fYW+vREp/kcrCeC8+1YqINBUFJ4EmSJQkYEjaPmmUxh7rRAuylC32pSbjEJGqEnHSkY3mJ3yWPTGycRGDAhtEO25kZm1BmDaDr+TWZlGtqHQZjpLd7MIz5CIoxI4RUNiRxY0kkrx/3nEFZJI7zLIDPrrWia6Vlxc+cJFqXAeCVDR5AEJSG9fAUfcVZADrNehNtwDPfAl07KDzDMTLtuFu5hLaLKA63E8tC2DbBii6rCu/TnVzIz3sf8K5djM4aByCxAzsWY6v+iboLbcAZ1exzbpGGoPyronExgTWdTOLL8ap/1l6L/ohHizDhcpiu1HC3R6qWKqZa+jmMIs7MLmMuzz3deN5qV7NSqDw+fvdQQoNUI+YNNZM760WpDQiKt625NqMWHDJ/MyIsd9wBvrnPg6SoaTyGNK6b5Vk+2YAripYvd/hoRt2X5wSYWQYJ0zwteMNxSZkB8Jio0WEU4BvxXDzbLe591AR2sxFDWnd24YYlB7s5Bap1LnzyaVvpqBDc4ojEqEfWtr7qBhENqAQINAx3SNuy5OxiQOl63GKe4IkRC2swUc/FsrhZe/ivnIDafARzz1QMV0ox46YJ6CnfinwhOdYpmDYjVXBtBnn2fSkwlZugO2LqV65BRvpQ/WOhRAQtkP/AgJV63u22gn/ZzhDzT3wiCeCnvs8YL3WjDelifMqHyLUe2CFrvtMgSIHAyNwJavW0W5ir6SombbSrizEeQnzFy0zVhTynrFvUaWQlPU2GmOPubWULScyYt5Zap2SbklZVJODPAyl/x7qfV0jPUXV0C3Opbx4W45DHGL5WXr/oINaBmUd8Jzcb6lIaZmSi1rWmbzj8ChWd3/UoJWCymBDtKXTtr5XdJvamnb7ftpRi6oSV4T5DL/03i1mnOvWALHdrqN+j0ZpThXNJO2WM9PN+LBsLGPaA/F+W5KhaGaMWv79ss1sT5fW0XtvZK6eZr592VapOPHID1Pde1+oJjjSpzwfuHAJ2J+W9LQjuVRPMVorTelvx/to61GvnYCmdRjk4KWFveLAiCI46O1AaOGyScWuubTfwC94mcWoyb4CQjpLrsWEdSQ7bcs3QSXu3tPjvxlF5IpbEJTej3Z51EtOum0Ar6aTz8AXjfEgpOkK2k0c2hUHCVXEXKkyyEM3CcPZWnlkFy1lXEqjcTbCUEWibfMDd9ZBQu6vqU2oF9b6GtmMPsKUsOtnT7CK6mhq5k4wN0BMqRkkoOy94nTIcNAAPrjGSBxZ5u4IwxBTpbXxXfDkmdnGd06qmDGzd+II79hOJu8VZd2n6i/65HRxnWt6AlDXWmol38o0+vJYqI17qMAiMlNHMIEXo/TK6lRQ9kgwbjHVPeUlWIkx5mve+NRuk7B9SooyawZ9srPYAAZOr4NuuwPjic8ANXvnxr3Zet7n5mi39Qag66M8bVOMcgZCmwhQHxtuqYNVR5TDaekGmow4cQE/bPnJL4Q88g5gnlZeXlY/6nwOH7kyJfErSU1MG1JWMCAjGXpDjw08RmfGyAeWlNZZcfjkezW/QnZmIeVExMfBvjazUopQ3CD9uI7DvCfiXPQDCdR+l5b1eFS88wDDCSk2s1WRYTMukpdpahViCugmtDZCNROSzJXwQ0dFgXVNCnySuAIA4Daaib4hcumNpDLLrIOagaK69beWU2qZZ2hZeMVoTqtvhrOkAsjRCA0Nw5GWnKNpxT1KURdjNpqQ/eqnXPVxhVB70MS6ZixUabvd1mwAvLMAVAFAu7KzzsRZLaAme8UApdCeSZSpcXA6gzAqFvUPitwjQFt4JE5OoI96IuhxTwe8+troxPO21DrrVDdz4LS90r7RW6WS4zxv87At8fuhoRtSUGsTWxycdklulwJDzf790h2gJz0LenaSizn9EPOgac86xqVZpktKfIODkUQiVLZf3uCeeMw7tHH2LGpwj/ISyeCYCIFJL8go8eNntvFvsS61pf9qJjWLO0+F0K3rLDSi8GJaNcOvwCuigfzfqpXVmEa0SzhdNyxNXVfTx5uNJMZdyNFwGE4ihH+RafRnQzSpTBWjh0CZFSZ5J7jLQZSBGKML7uoSowm0ObiXVRk84TN6SSaTZlpqqJjUjRUjQCM521DI3JspZKTJZClpzinimy9SjtT/jtnZh0H+oTAhdeHGvgQjaLiIpjbBrJmLkVfPo8/TiVxkBI/hlvI5FH8Wggnc/jjg/K2g9cwMKRu4l2V8L90zC4Q3+QibFN7Nxg3LciQOkci06ibklZJ1VHqCwAFyBNyoueH5EL4HQaJZnvBUO8zDF7E5+dptViO5zQblitouibCHxXveQw/uzHUa0d4LVUXrbWGKaqgs3ciRfmoW3CVNloxViwzJXPcoDoKus+K5hy/CHqXXCVc+TWBX6NHmdUty+il0OGE9DrS1GZM1cZGij3Kb6CyVtG3ypO75YTLqUPJpUWljzJCkBt2mwqQNUXCNl+EWRmHfTGlCmFFaGauFGv3BGHHpV+DzcKhHfnk6jnqZZmIL2cZ2BTPMo6lCx5+e+2UoBRo7sw5PkoeUaWO8f5ZK5Q2REGkzCJEMXgidRJiPBMAVPX9kDsT3JYVI9oY7pCOtTzbWvX2wly6XyGk0BljbcJSU3HYooAeNNFJUWJZo69V1KwXucsm8zWg7JSguUf19hxjrAOmiITts5fzNjuo3ivRoU4couyOBONoE8dfI1UsHTbc+Xbu5JeXhoaUo6rCZzHLqNmIqQAmAOgs0qh4E177sxCgi4PsMflKZm2boq2cFkG4whDg8EodIcVlxKdCqX7vIiuNQuZVSpqupu6E0y+UNeIjiRMgs81Y/RG0MCKnyi/uIQlowgjZ7Kc2vsQ1UEt08GLynSsIFemKMllWTzHTmMRvvpt2HZQCm8afswbBeSOdapy81ZxauebqVRd6L+euk8OOn0DastuHjdAzOtAcuGqlnNIDPHxw5PVQFnGWYVAS6BjHJnq/EqFRmshotSGOWG8x6BlmOgMu3ZdmeFdVm7IeHH9NFaa164wiwg4NdN5BTAU38tgr45tLUSMYVqKvNS4A2rMCc3MSpcfNjse4WqOyrlA9XG2pJww01D4l2MN3Sf2JK0Z/XNSc8hJkbJg/jVvbXIaklcx5b5muCkyqF8+QkCNkmxCWIEclGXFJcqbFcVA0mMW+xOj69EFlTJaqqaUyaZLzAlbTUrPU5JHJvjNLOd9FgKdb/Rcgr2jg4bGcbkNMR5jYy0RJlpClCohDuU5+Bkf6wFq6eGTViKZdcTjff1EETtVx3qYUdNwAaWwplqUUVSmvVxjqrs83RibPHQogxjFyS0lKnWFL20WETRc14QotIpKtXPk0LnvbQstGIJ4obikZGs4h2xttcwZduAT3qiW1+XWq1PrLrGzj7dkKLX6umAWGj/jAqv+SYg7Y0A+BG9V+nZHYzl/bX2ARzEoYTi8Zjnwy+dDMwbayZKjouoVS1YGEkuhr/ArVhc95Oab/v1mIG4MZzj5k3Nadm1b0DtSO/15D40t33W7lsyhw8nTG27hFuswJLUdqD+ixiDY5yEq5srWSXZsXnse/gxgxsbXumcBOlg7Hq3jAwV1JuPyNfP7NpQ9o+5yY6Ru4t3/DJv4/S3U9IHSVCCXVUmIok0qzq6TyctMPMbguFnzYFl/fGwXxKayeXkCbNU7Q4BjlloEwYVrVbgb33Mu9GB3H8lubo7Rq9NKmuGSUmma4rnhdXFFNKoojMtTnbSPJGtLnLdDWttoz3cH5J6GzdA7sFOHcJW/y9wiSopJgFnuXICS0FGBlrphsST7Oc7jf8VvG7jXrXbgTSGAJalYC22T41M5EcL47F4ridEp0krsiEdCt2940vA9UejuHTG7vZ11zItKBGddS4+hn/PJvpYZOiezhqEnCoiGyh5S+GoWzKbCItLUy6XYc7pE+atBnE6IHJSn72ReelZi6rM8Di9ox0giIXME4FaVOFliaSlHb/OhtTUknSxd7XUgaWrtNWzmgqjzLZZv2ly093D/aHFAYg4f9HZbUUC2U664najZkLOugArCU7ZdrEMFFn/S2Uc+WueCNuzi4WoJ6Rz9QoxGmWEcy8EbNjaZbNPlmJDyqyE3mx95nCota6kKa3X7p6+W0iriIEd+ciB4sC/fbqJdohWqldwy1MgpoKkfrNr5tyPDc0HdiQ65YlWL+i4t8bTXBrJ0DUfA3byFG79ZLW6MynSjycKLQiEXdtoG9zvnR3W8epR1TfWnbqLiUOqXBZoLlvv2g6JNvhMApr4SXn5SnMkRpVI12KZyX2uiY/DleONN8ISZWy04+A0NDMhO8g/N7ilBu3lKD0oIx8hf5sNVm1Jgn36nvhstALJSlXUhZ42DkjJSLKzHH2YOXskRxRtIOamltKIaTM7Ei8UzPVE3B94TCzjw9bfFh4n6lg+MKPUzr70UiDjRTZ+JoA16RAk8AgtKmbKi03RijFkrMxj/gBF+aTngTk/54Lyo0oMr47ylR3g7WS0SYImFQ67ThMnKqqyXvQGheGykuoRUg159gRLj8abzmz7bqOv86TNsuOSkGLB66bv2ktUph+HkbOaDcGPaQdVhui/XdrExrl97cyIMuEmfJnyFoaCY9ri9j3qIhyVCbTcwkpE27icQfiJbNZYSkXfdeRcImsBpU0JFGsbtM9mutwueeqUB2s6VhFpTBEeRRAuWz0GoU0bB7tQg19hpnG5vqKm9+drjbPWSsrs48TdeNArDXm1cjAiPASB0OnW4XD3YYbzrJo04YXgGSUSXWiAsJNpC0K6qc3h6DfY7b9dqVwRG1suGgb0o5btnTScHOlDB4prBezlHdVCtYMuNwb2rjSS/p0heXYyZJEFQsVCDvmtaqCCIxII03/AFwQZVbk1PLxJLnZKb7gilZXqtuew0AkzEao+SlIRWsnS3Pj34dtYEQsOO05dFTuvmiju24SSb1S344VtXH705GWtkzHZNdtKgBH1FHpx7HBRqiJRhlTsJtiWFkoyMI18g+jnF2pVHa0rUiIymQgAMLUJWjYj5lzMHkLl/2/cuFeWp55mSQ0QwGVJ3HJnlv1ZPgBwGNJn0PyMBOLI5dK7dXts83DzBm2wU+JBxzMREy4waq3Owkt+R7wdoeIjfo7/dmE5ydRjhID91vipNfozRqphGG58hF7bABf2SvJnGahHDZhaIaP3Xc/knrcRhkibh2ujXXo6TxKjY6Z3YcJJI5HkFEdAdZNXLaQZJCpqpF/aAK8g+cABGNMGsKOVKTB8Y04KYtYGHFikZsYLYn3dh5ZxoMaW08zPk2b2lEzbyFYWsb0smrBsgdof+o/QrG1523RFrptoVLKqweEIdLWf7p1dOATfkAw0Wb8W1Tmg3K/tQRVfVBhBdj6D5ZXPyyCXCfUrcyS3NWBRfYYrbD4hm1QCkfensAMZJp0JAZ3g5SM7IoDmxevWuPzddBw+vjQwW1yint288wtXSiqxzZ2pZIJa9Nqk1JrgcrUIy3myCoXjhYgIsVVzCq8pSvZ+JBdKdqnPLTJLLDDkerrySXA8btjupDWZgwuIx+Lsc4ATme2MZd5R2i24eaGAexxWIlJbQ6dxZu3/D8kYyo02gaw+UpZpMYao61kUjA1VpUjwcGjprB5omCIxtjFxkKRRKw9XCNtoX2xruHQIzUDd3MTieivAAmHjWwiTYjc4zDUZAnyhKty6rSlMgHJ/5TKvUVlAsc76NlV6IN3N1S9/P37HL8LfMJOPOS9ESl1CNSlJafqZmasqtsJQvvllWJzcGOhJTfjwI00RsuqEAdo5N7PAWdXgCNKIJSDE5Ay9JmW67F5RCW9BJBj5KhQtNF1Z4bRJIcgPr9lZBMUOG20p9pdhagNQD0xKNiv2UK52YZGqnSU01HJ9AlFM5qNSzOUsBKEopgUeACJuq6BtMatGSYrmsY0kZWY7EBqdv2I2Drfs+GLsFCbnlDZ/weKTR7SGaX6xjuOLK/PFH6UHnNBqtE53ZZJSswROfYxPgt6rNLWKixO38wSlDTYCIfc7HmkuZ/OZo8s8jC0XQZ24fbigEnEMS/cPOYKVAwSRZh+ZrxW2HllqnADXtzUBHE4Op88ymwlT6b115rrmclQmDBj2S3A9YeAez5d8/nuRNxGdERbUUD7mDY2X1s/NuT4KH5gzLq1VRehwb/BNzS/V4sv34xGcOATqF5BAgB94WPgde/luRGuguylzTa5aM1mNceuxSgGpiRKjsEOgnlruiAdc/Mz4WIocrgSN41DzdwLx4lNn1+zq6CPAM/SYo2bm1b4W0pzjeKyiQtr82S4LmiR8+35UpGLyu26+U5SAbZE3Z6fGhiODEPVDBSd3tInfbOCv+KXkDP+krY7i78fIJmhmNTEJH7b63SOeyvjfSwTHzZacGaIXeCjjUiMyYUgHr09g3stje9CZduVDDv/HpnpxqqrvSdaCLLOBBnTPSjMR6PCIG1jUM3DBhEaEhxtBwMhlYi8GcmF80yX1Ma8F0FlRllax3hpnkHu+YypGXmpGPUuetloAlCKtwNBUAZWdCXhZrZfFmLab3DCxhOgx7bpAUmgjEO2rsKa9rB+dt/1iZxrh9V8Wb3X+DhNVzls0ijzM7N96jRdIDeShG13B1WjtUOBxAjxmRvXBBGItHlUItyqPRRn0Ro9VoRHEeKo2XEPzWoyOCWq4m48ladZbEb3OIjRY8jCF3MGTgJecGrC4DR0FX7YkRx4K47IaETF7DEam8wj22I2ymOAk1YqSc5JUI3bbJS6ss1vVR6V5hKGDOvqvT9yxBF86ZwF+0zVTvGY8RtqnF4EUrFlSUD1TavM4KMlY6czP416LNZ0EUfkHoiRhRYua6boWbOcRjn6HgY5eOtA7KaV/l8K5BVo40iPb+r89RgZctOMD4sE5/s+Cdx/J2jZQee6AeOJbvDpLUuwNqDXg0CPFA+h+AOZxKNb8lDNknXzd6lJ7xZhPUgE2M60VcA8oOsJ9M6Pgo6OkxuvPSYsZLGx5sLyHatpO2I07J9jtgSd5XaouItHn9bkYb4RN3VgA+RjXPLWs+nvR4m1ZL/PzziIbdTcnuP7QHGIaJV6cYA2izpd3VSGS+5MbFZ4nRSl3GjZGWdeknRauD6T4WlexHbBNOWmgc+jqhj3UmC0/lTWNampaBp9A6zKaQUbHnO0gjGuk7rhWUv9RXErqpdURvMNdxLLRQ6zTNPzR/ZAKdKivSj8IanIWglD5jEYwQhFAuKFDItYvZR3XbbkpAM5u0WMcIJRtrSUnDxldcPAi5I9yt4El7oNehiTSivl8metwNEx9M6PQz/x+8BYLOeg+TVsCTzFB9io//TGE0PRlKkbbXHb/EpbvOHfIAvWA4nxw0YJ+JpgWiB3/R708x+DLsM9F8oRKCTUOQLMcp8zZddaTC2tu2iCsZDVJeEoAVGYvMKccALTCoq4cluT/s+YANrfo5Sgrk+xS8wBQcwkssbGz8g3SmXWln4cla+Yx0YeHJE+vOFvOLCZpMTmndAyMxpCbvtzluMWZoxnwxGLQ6VcE6cwBOlmHALZqJfslufKNeuzoy76iAfYI65QUUdmVkD5QmiwS3mb5NJLKJ1rUTi1dPVm1OnGpdTIQhBzkJmrs/c4LZ+6sivHIKNy59LzT0ub0AbtdbP44gi6cG76/MwkY8dtGhDsyenzf9R76n5aHFXQtIrk3Hngyn3AJ99n75V3yfE/TPjI/LqtNU81BtSCRptQqGcBVqCI3qhLPwASCA3DaN4BB8ThxGDE14984J3g61dsRh1EsH5Tx3PQSPiJUA0ujwDSZmtdFUC/XYu6b2axac4RtO6khBvvpKzUtfk/YkNTtrEaVYJv9Pzhtxd4SWBFLZU3cgo3dt6ZBtwnRVTRaS32y/wF2P0KpFnLU1ZYUVFnm92kvqFNSYYjE7CzQBJ4G83afunw5Ndgp0WHHQAWbSyZm0AouNyRzjJiaqNZLpXCzCKvJQ0gtnlnFGVgiodmItjRD4avPrF77M+JMZxd1TnPDhax/1yZNpEYowGZsc6b/1pWMM0GvBxx68MPazD7dyr/NfFxk+vWNaSYcbNktVHSzGRzkbdRH/8t6H2fBI4u+HulBv6hTQWcZZfEkmLyUWf3oWU49vCUTLX1wIg+MtzYhWuSfILFmaKgzRTQ14wqwDvolS9A3/8OS+HNkbA0Xoi/do0kBYGQZycGA5Pac3frrJg6Ia3X7dbTTNmhdBXqpbCyj+vcaJTD3z8doqWpL1G9fFLWSw0oUiCjujmrzk5vb1kE4ZeRF4S2YNk13YUQU4aG/UjkErA/oaZczSJ9GRjLaByQ+nz7M7fWQpK1y30Wr5Bmw1QUztQURQR47yO5nGLDhTWssCk4/s2hNYwcyN+IZQhwczqlFu0slUhEjZ7M7rTvvVaM5LRhBKlzH7Xp4GaLpVaTHEnljU1hFqLFmNNS98HdYROIi9eYTfhMe/U61Mquq/5d6vVIs7KaK+jCRchnfh/6kd8GjyX55SVVLfT3RpJOY15SmYfUaUEbO/Ato6/p7gMELbvYLYswF2t9bR0mToPZncP6u+8AffZfg453RfUOq7QZwZVIG/fAo0JFSqy24JPN5y2eoolwLDY+DlUadRiXiMsPnaAbq2wCbPIQo27yGpLhWYcW9e9vilnSUn+qtoSqudW5bPZRePiXu3GOBUlB09SqaZnXKkdzk2qMw9QwUDpSIfM+4kyfoClNjyLgsgSXZr6vmB7MYUYcSO9xouLFU0/iSXeUtcp6zET1GdXfBTRcGuooxaUESyxJ9umjPkP0F+N1g6AL8mSOVBfrrTRHlmHfzMPilkT6Cdv6egelgOgFNYFD4m6WggRn0nOfkSc1MW16y6hGShMwSziU0tNZoY/LDnxyArznF4AHPgs6vuROudzKctr8f24yvo0kYJNAW1be1GTDdGMSyMbXJ8k+tGEN559vvj9DU49Bpw+A3vULGOoKwLm6dqPFooM2KlO7IQ/VjqgSm8Ni3UtezDRIyX48MZ0y64zNJ1KuTaLiPhdlUCJaM/L0zIo4MAneijSlZX2WweDLqstBvSACBeGrYunNLCfWaTpNx8E72tjR2ayhYi0GHJKAJNKyARoYX9wFz11shzlv5jp+ewjagg2wjarESd+AsDd2849IelH3wE/gni0+K5Rx8DjoNBGZs2S0rp1Oi2YOr3PXkLvrCg2UGCiEG8kb0JTppl2yBzekoai2KKy4uYID4d7+xTko0DMUgSRdfVcgUI7WYhoglZqMaVORLBdjMtjFU2RjT714C/Dh34H+zq8avRRLyaabDddWlqtVKh+0C5mipE0X0CZC2Qr1UAmgOd5Uu7fJHmzVR40dCbwcQd77D0Afey/owvmm+tMyyEQZXiCzKMvSOtYBtc9140sQVloqCZBF5kJVXIEDUDoPVSKQA22DWlBMC7txCm+yFKMVZU+rhgvR0h5OUodgykZ/JsyZQBWGM9VuSlVR4YwUzzVudOkpVIeO1c26jFuaUVQ7QQ2PSZqgydVRZCYkou7vN2y60ET2KEVglzJGhFgluHIChxTkG9WWN189UoQz5DRbWgwXbZ1mCngsgwXuXmphHOr2zBYg4emqIR11HjdxUV+yHAuswslKCYrFPN8diiTEPrsG6gXZiasMVreLLjs2SfMPGuwTQC01oDhRQydot1hJ+1s/B73ro+Dj834AUDORoUbf3cJxvY0r557tlKCnGXaGoR5ICTcHSqMS93DBmggQaHcRdO9noL/2tzDkBLQ7tgpGW3vhseJ9PaC3o3pAFBo1wiT3meBllBvzqNl/9NmhJiWuE7Nuaa6A1/1aoFus9BZBnqDpjkt5urA7V7OrFttFwZxBtj1KPYJPM3pOOUfkyXJUNLlvXaDWmoqPhavqzObXq3Hikb6A+XmMMm6NliMmLrnjleGpt9XnZI+L8tGPFkDWmeGI1EZC6jnu+QH54VzAnPENwmdAum7axxWqyNTh7MjY3HutW5gOtvhpua61sAJdna3E7k46XKEP5GVgUWMdPdZm9EhkwNxCKdekpWkRqHIPM4WXtEZV4Y8oDfjyxGXLBnQW2tqcatWorXrpJujnPgL9lz/rLrI7kKw9UKnQ5L63m+ONdn+f6NUbRyCBqi762bqQbseLDYc4PDHs2e8whmL+s58GPvMB0M23QdezFoO1epru3iq8uTY3nmiq1grAbJqFuOUMfHO3qbAAp0bvbQYu6rdezNmNz+E3sbQQ2AT1tVyEfLSlmxmsbP0Xov/u1GQtc93UfKBwl4yfp+ZQHEQ20MZgJhmyoiY3zvekmX6d2EfgIj6ClxZLF4QlxKQtdCDxy4ukF2IdqYDFoB8ytu4kcbAtpWQjVo/3XjPhJbUE7UMhhieywL7WOfcAg8cw3rKX3dzIOgGYcVh4kZinu7sH06It100hZKYd6lLSbuoIMflySts8GsxueoKyPwenSVMfr7iJBaY7DbvnX1dydbVahpECLVNgtSmANNu0CLeYZhXFly4B/+LvAb/zj0BH50x49TBzdzpQ8h0SczZiogPBEJphaJ9IdD3AIceAYjEnUCgQGqDjc5AP/VPQv3wL+OZHVNIzdXut6fHsxhyN8Jccvw0qtJ1RI92kxM520RS7L9SeYTwaZW5yVtCwB22SYZdgZ6Lwwh6EU2EkmfiTduGS48ki+9Tomcgl46j03hydiibYrPm+qK0dKh4Ba46X7SYffulObEAfrgQjLPYwx2AfL7ZK0aPxol3kmttqBnGCKT3S0RDqjV1W+PT5gwzZbFhs17isTsQgKkSfo9Pm+ukunKYjZQbCA835d+aH2gG4blcdBBG7ebV5GvQN35JcmhJN05O9tbeLSZzFT3mO2zNwkSjrZjcr3SbXBkYRoyvNA4yKGcb5jgr4mWfAcmw5Bb/4X4M+/dvgcxcT7KEebISO+B9qc1pyrGozZtUtj7yqeBwmAjQZTpsU+KGnauY9R+dB9/4B5O//GIYK6MIFwzzcoCLbxuEJue61n/wRDxIxZXdtdE1sQyrGbTS/v2AJogA+TUygtCaKlkAUf88ZeAj2JKG8IcNCrjNhxb0CR/sZeTBpsWdjnEw1ZUkaTVQFTXtQ2ZOouDP02Hl1kl4jaXGRfiJRuWNB3T8QkehEPR4cYEtKlSbCQQY/JkkiS0RJfTsyPWU2q69OAKIcwVnJPNMnIHrhzBqIuehcjSMga6HkccBElRAinvTr672iHTbhusNLc20Z1Bx9K04rvAqNK2Bjl2I5hj6hXm8ni6iGIKQcWmP2nz2/z7ZjJmtZh7P43M4hJy1NOmVizYSu14BLF4CH7oH83F+A3v0h4NxFt7mqeS6FlZbPlkm32gDqJX54NeTiRXMK9tIy/OHaz03SicyyrnbDUxxdAF2/C/Otfx78wKehN98CnJ3mJo8bNufysVEinTlv6nIEElcDktboLfT8ZUYkeRtz+kKU1X2nnJf/peNZM/why9fSLrUbmX49No9bwnLiBC34NAse1k3/v7lkqQ7xtElrbs1KpT1I0g/g0XWSBx6cK4OQQ6OMZEUnoPskDMUkqyiGWlabmSMe4phwhkkWniSLrKKQW/78jFhnVH+OFsAYfU+QE4afuGOAxpKjtnx4o2ysOUgp4cm2oIU1tgipuMmDfJOo78Rc/XDBLIJMAERTMEN0RCWTZbcRUwiYZll/QRvooxU06mAeccMQuEpoibyAmMXO1cNQpBZTHLwejGFy5TPQpVuAz34E8+/8X0Ff/H3QucuQuVrkVhwyaCaSKPyG0diOG3JPOwBIN61DmlQ0Eom1Ne7KLCsEgikKHF0Cr/dh/ux/DvrY+0G3PBK0v16qtswuLMMZwrQbDZq0cDTBTvpHMJlUmHDA3AyNvVtpoYeONpsvrYBQCuwibLtcrGMGsi3gZrBXcyh58ibPMJKeHEScq63/JPhI8yPwZ+YEODRcjalhBdSJO5VeRe64ne0LdSPVcj/uBjhpihtgI9U0JIN2/YLlLt1EFxq4zt161PDDr1EMc9MLMCyzXZrUMTLUWpxShYTydkQtAjoabrrhDi6um86xCHfbazRfwei/nIGVFlMzfeiIdBsd1jZZBaNMMDu3IIkSlhwLcVPQVlraO5qNtITsrZIB2TP2msEpBvthIuk6HKquoqEG6YXSxw433wb+7IcgP/WfQD/9m+DzN/tsfd0kFQdwRV2dKGUYWgCh3uAvgG640jUYLqayKmjmvJ2OL4Me/Cjm//D94A//JuiW26CnJ27xXlWTiYBkwy4m7qanNT+PkBQ01Weai4QQJ1om4iYMaqNPaV6D6uvCXYaMcBNjY1fLSRw4S1a0eWOiKrwy4+jGrNIMOp07QhE2s1Z1kxboKNtxlQNZupRdWBtJKo2aJk1pGY7Sql9pbj+uhvUTODWaRD5pkrAFR0YahW0xt3gvDVNPKq/8ngwM5+FbPh/nQqTRRC6kmYQTJxZ5aASxGNjmQqQKvbBNFeh55rkHgJP8+dUDNJBegukfr9MOIiquNbm0lNBNFAi8LNY7Dr/RA92dUiNRMZBJdPUStkQVccvZGuV0vUGfsXeL9UFF3Y10pIikjtcaEdnBspQVuHQr6J6PQ3/qP4H+zt+xQ4CGpS1j7zf0atgKKhdPaWvqeeDwWcnCtKUBo4F8NoteMVUg4wh8dAH84V+G/NX/PfjTvwtcuhV6dlqAcJOPWKQV+y2JCtDgFmVOxcfXxrDkiFFzjIAGu7lFof/pVuf08v7emOwWlTh8uyFqkJCikmSfEMR6HwWebbIWA9xDAHMl0A+P/mxXnGGb3BeSejCD86JI7/8+Y4ncghhbSzkzZ2pTgoDtwErDUgcPg0ilAuyGTegyGixkjt5bqyMxTOxOJnGxxEjCymUrw0ONFXiwNqUXsuSKDZmmhIkD+CaL+X5opWlCsRYlNwlJDvLMWYGMGblM9eGhxVAr0n8gAxOxBWA0nq62mGpIRXDFmG+2dF6Pd6pnovVzUBRZwy80rbe0G7ejKJ1hOxaegEkG0XI5wn4CF28DXT8Bfub/BnnbD4P394HPXbLXuj8B5pmzMGeq4tDDXvEwwb9oh0Bj/0X7QroCc4XwAjq6hN3+QeBX/hL0b/xp8NV7oZdusWmLtJw/cRKMz+5tM7S5dgcnxRWlVPbqQfW284TK9y+z7zzBWhrCL/LwpKggOKWtvJZHRTobFSEnjWXVDDVTVNVs08Kr0dZFk86notS9JidtvQWykmnZDFwRd5k92fCNHItTBaYg0rFidI3piUho8nXXm3iVWEYv9maWjNbyBR3+nhB/g8yttwaES+5IVO6jyFy24dJXbHTZPXQ0XYViljmaxDEWxeKhobMBOJk9CL/xfS6qvSphlwCXair9/NH4/XnDxknrY8DgAHioJ6i7vXDy7BXTDU0FkIOE3OR3oxGXuPTcHpNmCEyFqiQbl4v4FOYkmzHW2QrdHRsl+tf+NvQP3gN8458GP/WroOcvQ85OQOuJkULG4ldk6GU5La51E/Udh8Cw/jztxzwzcdmBji9g2V8FPvSPIW//68DH3gfc9CgIH0P3Z2Bq/jLcLoJBBZKF1VUnFPVw05YrEaOyIDuD7IY2M88Ili0Zc1xIQLlQmZGsYwldVUkuInIjYUIjw2kPh+Hy/QvD1xk6lbFN63F6r87CJWyt+7qf4SuJROJVBRxpHksh/9bG9gzE3aaltlaBi+Q0daOgLeVhtCU94tpH2AAWuK2xefuVVbNCtmaLo0o5XiK5ZZ9WS+LjEtJe9klLb2H7cMb2lE8nnh51TZQkmgCBrGJ07f70zEAxCW2wELP/0TIvMWlw2H+FdXml2hLpQdx29OZk/WXKVikBnGjwicVcaJpa0RahB45KeMqPjGYiJ7rXXgm/9gkRtjFVcvQ5Y6MyjDV4CGGJddsdoDs/Af3JH4I+/+XAy74L/IQXA5cfA51nwP66mU84E4YyFZk33H47aGYStJz6BhxdAo0dcPIF0B/8KvQ9fx943z+1b73lse6tcGZQo0Y/7TwKadLXeRDrFcEujbhjYz3e2LHrrEi5wKrSxmuGotQNZVwTTAw3gKVS16EJZ3rKjl9iSrSxrINXLWbHUIxKzMYFmeVGbPvByTVc1ZtV19wSjso3w86w4YIfrjXBZh9OI4JseRPumqrMxX9nTNy0SF9tgNZ8BaU9EzuFl0rX8RLHc8+oKaUSvW355ul951TAckYxhtYmKCRKYSfTFDWWKkyS2jxeymyDSPKiTIZUeJ8nZ8BLqVRoaRFKqHO4a5pN7caJkiClxxw5axPMdZgFCQmoiO2iakalYfZjduFuk4vEo6U5vOi7629mJ3QLv+lacKSJZIBZZnriDMibLtqh/b53Ar//W9CnvRT0nFeAnvhC4LHPBfHtDtqtpWiM95Ol1w40joHdaP3/hN7zYeDj74L+3q9BPvLPQSd78IVboMTQ/d5Z4cNQ8/ShI0Bq0Ua1gdUrR20puxFmgdHWXNO6cGj9JINCkzgzyA62HvvdVaXhvusjNualvBKYzMs/vCOkUq5JjUAjUlUlRCFcUVs0/JCRmVFniq4z0WYKojnBQgbdSnFjfM9Yi8su7CrD3brVteznHNNIb4VoIxQHfu+UDsUUmgTPZSBQsPDrBDZLq0Iqk6e+SvZAMf9NGuIqaYsd8VuahgiSJSyPkgpr9PttdLfhTqejcAWWIm+vmHFaXx0WUoEACyRNR6mTa6iRLzoPPUrWpq6iqlOzHM4Un4ZzlM/cVixjsU4jswdSpx0ffDPoTLFGgEDRX4669csApQM9vpj3eyPWPOIOixf7vX8O/chvQG9/nB0Aj3k28OingR75JOhNj4aevxmEoxssRPTsi5AHPgfc+zngvk9BP/Mh0Gf+FXD3JwGZ4OPLwM07yLo3jGEp/4WMkXPQLebdm1FtZy+Pdpv6ZqIxPA3FbaSnphGHtVn2ecuskAzI3tOcaFth+ExeIrgzKLZRqaVRipbfBPtzj4MgqpHAFaaCxuJIvN+qgT95IjBAThEv2XWcAbmOPWmaNlBQc1P2Ss2k2z6oIw9IpRa3N83YXyVwtqUmddpaZIm9HK0Rp7anZDih754tXSfegAMcySdPANvVeBH0IFotB1VSDTnpwUq26s3CbIOcq40APJg8RbeNBKmPNnwm74QluDowDUp5lEkDlYgpgigCRGI+8Ll3XIOauUbMZkMII26Vrm71LD4izH4/yn4H9zKXPhJdxG/WrD4LBIuFmW4yYqNH0hYSkgSm+NwcSXZZNnbHwCMeY6/n6gPAh94J/civg89dgJ6/DLpwM/TCLdBzNwHHFxwEm8DpNeiD9wDX7gWuXQVOroBWFyVdut2clNbVDpj0DjZDzljk+WwDuwiTSh7Nx6+FnIRnZ9yoosn/SLps156huVarQNfGmhTOr7XqpoxB0LwdIRM6ucaFfSRHw3Uq3mLFZosqxSPG4B79GsD4QhvKdbgY582d7NMAIveOnS01xiZufn9aISTS7dEKaKdkI+rGjwHsQCNxtgAUUyevKHWp3m/ZmBdKCUUrcOKA/E9b/niOHiK3PazAtVh+PnBtqLuUIWTOJu10paEes8Suxy8dtNlurZWqmkg/OYNwei/FRYcMYweIl6oVf5b86zgstBJ8w3mIfBJg/bOjrHGVcdk/ubtDsgLtw9tDlTDYk4dnzKq5vO+1uBSZTYemGwA78DR9o7BPBnzNjSLzpIpMPA79wk022xYB5Ax0/QHgyn2bMZg9Y3Y35+G33oBevNWBIwfWxL3qMxdyZitHTUNPfbrClMIvqyRro0j25JobOSoeaviE+e9zuQBTu8kjaSc4FNOJ7WyXDWNpzlDGGeAMHxkVf5aBnXsDO5sC0OjqCizDY9eaL6KD5YhpwmxxSxSuUlbebw5twA5sD7uNPZgAZCv5K2CWzLsgI9R6XBtlwK5VSj5Gjmp7hAmNa2HidVk0mPVfqmXQEchtapsbkYSa00gi8tMeUDKZYjwZqGiW0xG6OHxM5XNdnT7vlHKs6bzmQUWWSCbhaKJ2L4+ScnrAkiIbyVhVML1MtVaBShDZuNNoKjQCuZedBgstbwNsmGk6DLjrUwNWs6kyMKu8+pKamxkLoeqzD1DgZSVxcsCp2WBlJtxU0M649WkYknmKKxTuBMvHcLHe1nwyQYf4/hqHebZUMaecsQnXO6h4vl6Axclz8Nsq02+wYRWUW04ceiaNTZeeLL/LNaf6T80bTVepEZ4ZELp3hOc7sH9fE3SlmWg8z7XjBXaw8aY293ZENBN1KqePUvkZY69MCXIWbc9KNFanVaiI9mhZPPBToni0ClbKst3o+gxyzj9GqWVpEEjIOXKtmmSvjjUixSRzPyDFGl2KYoiSKbI2l5PmxpOfZNklJfEB5ZFnD2AW868kW3XbukIK6yxrbFSSbxoZErVgkEoJVkfUt/kYw/pSnb6xZ5pBJC+cnf8c1uVq6LGNhCTtk9B7fhWPFpteuTnANbu22gNIWFIubKOqUeyvoMSq5m1OLe8dScBCuRmp1g3Q3YCSZGQzURqLU0aDrsrePvi4iOzkb6hsy5EnQPe2yAZ7PBaVjwC16i5uOxLomass0WzgxTTpSo1NkKYr3uvFODX8EaMXQIVy6Jw2hnXhjGLY7d14AAUMc2NQ+nqTZh1O5NLT0NBTcT368+8moxBbPv3G7/0v102t1MT7aPbk2pKq49sXbu0elUHHwqGbdyyoBDvlxRGRYz3bgapS6HF6WlWXTdSo0p65fsZCEWLhOC41DzyKUEGmDBlIJl+UOF6i5rw+LJg9rJNa6kzGYnOz7VqQIEZ4lVvBMDMoJPucAUC9RxvUTA8kfdNFrGQEZpNszm1VEx/yKuUYI+VUax5ucdoXqAImd0fT7FsBck8DzQ2tigS+Krm2x3PJVnEY5B+tdkyxeP8mSSEmckMSWnwM5NTl4fN+bqAP00YpqFTVEXVadW4UrraKBrBw6QtjJOmTH2vFhhFdVimu+tlJLl74a9BwO9IeWe5lfuV2bMNFm9V1UoFJIFJsRdt7VtLLflZUWcsxpHQF8t49eB3hnR8bTCpcqMoSf/3T5v2VQi05Tq1U6KrObHxHnjno4aOROuQ3fxmGhlaAc23YMwZoLCb9lmlMQ09I1umqxkwhEiNJ+Vq0xx+hIeTlfnqTe/VdeN7S6F6uULKoYwp5rHPzbeGEQKI8z3KENepUts9y5AK0hzejW8lZvbo1GNwYwxE95/X7y6TuxV9pp3AJaYhIIv65TnbJcVyQlVQVJJQjvvCur9ilIuMoh30Syiyu37Ax8nOsIjt22hpl8AhFpyvBgpas1Rdqw0YzggueTccE2h3bjQ4C6YoxH4SendU4K25t9tsVY4PRZHBki+o29baCRbbRo/6ebPOa1Q5zle6m+/Usvunt0O4Yykfg4x1AR83wZJp82sdb8M+zLokW5KFoen3eTkg8ZzvaARvfjYxxpyXwlbLvzqoppcjlwpvMzvDG8zDPtEETcbTfQTXy0Nrkt6xJpop1mZcnGwCpVNHxkbfpkVqO33RVqa+faT+3UrKQhDn2PAOrVri63xT4OMOPeja2tMrFq00yp6zwD1gy4ZUjd11Tcpt/nvJWcs92cgWV9yPxfe4EFMm/GsEOs+SRdnv7ixFNHrwGrTG8zBfPjI9yXUuNTiTloBJeo2lLJvXBpYGDP9CUPfsIbviYSGPj9PFcLJrgqTqRI/jreVNZ+6DioSBarKIoocn7fqaRU4ugoSbBh0s7oBgWosEMrKfQa/eBzq6Zo+vxBcjNd4Du+BLg4q3A0Tno8ZG5BY0dMAaEyFNf+3/YGX6apSZBWt5XJ5AE6OkccUaOo8KlRvdnwP4acO2LwNX7gSv3AFfug16/xzCJo/Og3UXDDYKuul/dMNRSeTXNVMuXgPxAk9kdb5FAV47kSC05qvlgRNBpGnt6tcFjNDcfJLsPa7QgTQbllag5/C7OXg3Qb4Ck6PJWYjtfYPr7kmBY0tZ1qbn3UoC+Gq31SKlzlursQqdY7zqNW+EVtKx9Uof0DdjQ7/31Bfhs7z+SNGwvLGX3jFqQUSa2TPscPQS/fjDmOkFSvUo6zo7Gpe+z6+ljrQD48laWupnYRx1pp6WZyk4+abDKvwU2NL9+cuuwdIOBgWTmJdJCF2GlMkf5GvHTYTUdYiU0Wi/HfLvHaTvyiq4Wo/rdWoaSGmVve+YZIK6A7nZ2uJxdh169AuxPgeUC9NbHgO54KvCYZ4Ee+2zQI54K3PQo4PgSaNkZSMkccsQOax5M+ucmrUY3RiLNZAXc7Xi3VOE8TvzGOrsCuv6gHQT3fg6468PAnb8LfP4PoPfdCaxXQUfngHOXQUcLsE7ofuakJsACFdOemHbAeRlCTX2H6mVZEzCOiyAjS/2A1lWy4kywNSm6lHbyGTTKi1vENeq1zAJi6xMtpaDfrpzsVXtf0fKw03m1IlcT6OWkOwd+xg5Ux43ubccazP9ZUwgNzk3Jtm2tOW05nmlUSx5/pp5TLyJpHbcYkNeZVBUIYuo/afVpS/CJPqStE5luWkCV8YaGiOsqLYNOG0kmEmO5fqdSZQuEsIHVs+IoPQNC3lly2FHmlX6Iybpi7JxbPYtAk2QQtpw/Cwl1pDTbkBgZDrvJuMWAUc8DoCSjRE0bIGl6BnjEV9Jgp9s37XaguYde/SJ0fwq5cAf0yV+N8cQXA4//MtAjnwi6fDv0/E2QsSuPRokpinpHMxvZSTdJvXUSyzZWsGUGbv+khCrYJA81eyhm4NzNwPlbgdueCHrcC0H4ZtD1+4AHvwjc+0ng078N+ci/AD77+6BrD4DOnwMdX05GoCg2Rqka7LzQ8sf4rsmH4Sh/xJZToP3a7Lm5KS2npnAntPAqnYHZortjYgOz0BYfmYVbsdtdNbMRKgwj/jgOL7/diZ25urbKRBrBYYMFSZ4u6rFwUG+JeDtJSWdkH32XXf8oBXq070422+RfAKD1u79HaQGEJSWGGi471BxNm4sIhU49i3JkGEHaTvnG3UgzR+WX8agElNJRSOIJeRtJEH4ilriNHxN9dvFOgJZEOVOO8RxQab8R0IkRcWPuJUfkwhEUU5FpI2rp8lrTA9Am+TdRfeb0HEjacbIQ2f3dJnR/HXr9KrA7hj7+y0DPfg3oqS8Dbnsc6NzNmOPIHXj2gKyWAOv6gjLppXKUbeg+PUxcd2c/d117v+C3YaE3/lOdtAKiYrOleMewA+XF5vfriZGLvvhJ4CP/DPLBX4Xe+UEzWzl3GcrHme1IkS8ZXPwwCRXDbmp2mG6cGYYZbkdpdBVErlkeb4Q2Rg2sL7jevlmTs9BR2iC5jeGHg0vn4z07UBhZFHa4hIksWjsVqr4IQrVWZ5PNGNZdKVgjyBoCuuF5GG7KG6QgGgUiZpy9t745qm5j8/PnoV+8B3jJK0Drd/8xpUUhCzUXIA+2BFeoQBgnOMEghRRNYacxGgldO0u5zo6ybAo3HCak9h2hsU/XUaney/PTtJmA2OvhTJtFJ3W0ZBYwO4/e57wxt6XDcY0mJZmavrpmwWjZb/BYaTYfAUgKaUB1OykFg7JuA90t1s+dPQRazyC3PB54zmtBz/8m0KOeDuzOG+C37qHqN4BUkm/KR2mrT1cqSWsRVpp9Gw6yDPFwuX597NT+t/a5E2U8V1NgbefmTgWXtJDfgWmAdQVOr0Dv/F3Ie38B+q//OejqPcByHthdMCqr5ymqUJGKpoPFcTCJqykdXCwU3TGbMPgIeyVX2KlzBOqG9cXu/ge6Gr+Ek4HIVTE5RzxJPWKu12kQE9WIb7qoGrTihP3z8xbHn6Mx3CuVJEfmWuCz5mTDDHPLyZlyBGrtDRV7shIEy10pDpfjc9D77ABYcNABkpM30g1YtiGMMd5BG4EkSp8SVqfvajm/GGXWvdNCc81OCV4chJuzxlgtM16lx3SvrQcLpL55rbVZtaj//NGCJNL7oPW/g8ubIFKGZhxO3YghRlrkt4ymaWrdJihhDzsJYwhwfGQ///q9hhvc8TTQV3wn+MteD734CDMYnmfA/tTBOWx1Bz0rh+KA7uEkG4eBvJkV2+mCYhsFvjEGbm5APWgg3Wca/XjLbttajcUrY3Eken8Nln08DAt42teAnvpKjHs/ivmut2L+3jtB930aTDvg/CVgtwPOzrK9qRGbJn0cORrurSUlFtCj0WVKHppR8Wne0JIKRBrh1Dz8hnfPwDiYnPOgqV9YU5gWJKMMqZmN0ZhVLPtYb0kyUWYczhY4m/Rf5BoKqrDMtRmBNJZg5GxIDvk8BYkymCRES6HChI0B6wQzIZCnBM/K+jPKpc/WKdDJouFuqgHvLaKdiXkqSUwEHGAcpiCjxTICGfC5tlTf2r3+evZdwFwxp3cnGMia07qecQfX3md3S1snnyRzJGXZ/RHnmkET2mbA4dhqh9CsViA+lJiIyISOHej4GLh6H3ByAnnUs0Av+3bQS78TOHeLofyn131hlCFmXcK8NfEgujGmO08Aanlz2BwYtCntdfN3DYvbqCtvDBwpi624dQ8zw8LcJKslZ1KGFbrIdcxJGHwOdNvTMV73fwe/4vOY7/556PveBtz1B+BzF4GLNwPrHro/rcDbGP9GP6to7k9x6HFODMhvfh4OAKsrQqckoJDmJFLZiYlDZSLQ9K8dzWfUDXLdQzB1Y+py9bAfjnZhVhUI8mlDukuzu0Kj6MnOdUEHkVMB1fgs3orW2NwTfz2YJqjhtIwyGDla0tl0SQpjUHHb/iAepql3q66gN4qDdBWX1PLiIyE3tf5U7QPaHFYi9jusoWcbZYT0MSoRyn8HuJyBwxs+EoxpmHxUpgvKKG3GdYbHIBs9dUHOi0NsYado5abl7F44HY3Fk4itNA3+TC36OAh0rsC58zZvv+ezwK1PBL36u8Bf+ceAS7dD1zPg5CEA0+SfwUWmeC9VWQaDK6O3wvA0tY5arLGITOftwdbDQKlxu5MI2MUr1Kq0kIGj7LT7z4lJQvrxpXkmpTtNltBEZthEAOkest8D6wBdfCT4a38AeOHXQ9/1NuDdb4Pe/VnQbY8Ejx3k2kkJpdJOmzdKvvz8pB/sUnoKsolVmqBQBXFEpZt04cCOInGR0FoGqixCd7gm5e0olTrhTLMNIaevVyalt4UBBkqZzKoTfNK9J39sHEjtAKZS8Ia2Rh2fSTNdj9+rMa/NFhb1uOeIFA69MY3mCOR568w1cilvZN+IRM1kYRupjRZEqWjCoPS2L0STmHM2mx78zs4Lb7coBWkhC/r0WT8ACJVLsHjeXD8dCf5nITLKVNdRNlKuk8+RjtXxeYOE+i/IUpXSGkYn5omP6/dhnpyAXvh6jH/vTwOPfQ5EVuD0wRxFwgEctEFLHSilMerirCr9+5y5CUOgzeDkxs2vLQK8Wg16mMRg3DDPjhI/yuhNwFh8llqun5SgaXN8blkMUAHOrkJ5AW55Eui1fxb03K8D3vnT0N96G+jCJfD5C9Dr1/JzJK/UtDlSF2koqMJU4SDxPpr5BzoIGuy9GKuFjVk8H+fQW9I1F3CY+3Emvdn+GUE1IymGWZ6TYQQSa13DugwVfhJ28zJNy+GS5lxnTu9FM8HhVK/G5MqZnaLbQJj4c40MkcRIPMYb2PTzGRi8UIYSGPMMGegRfJGIYQp/MiYuq6um2UYfPIXGe9U07ERjSm1opCxbQMrRWm2Tg9RQR1KsUCNYRBFVZCFoKBenf9iaXIRuW5U3J4+ShKLdjlEaMwFHR8D9d0FufTz4W38Q/MJvg4xzoJOHrBwb7FOUbSLvpiTHwYV8EPiJAyp/9y44CAm8ofwnakE2/We3QwCqh839dnpAh6IibAwtseHHH3QvHbxApD4JsL8CpQX0Jc8Hf+f/A/KEF0B+8S+D7vsc+PKjoKenzmWIenmkOQfQb8EGqrmyT9ayzMowTVQoKJTTFSnNTEpYUVJvn0fSNF2ImXa0tipG3w0LycCQjfSeiu/fU1qd1UjpJ4/KR8xqru0jaSm1MfaWmP+PMgkZXIKqho3yJgIOlEYceROpbJpDZpsCSHraa/r3w3vi4HpLpP1EfBjpJtUnbgeJhOHI9AujBilqZrwxNJ+CUD3xUIg0lXpUHhLq6TKRRKQZKTfjRM40nxoT9cy8cvXV/HCleu0oN9mUd3TvXcCzXoXxH/0U+Cu+CwIGrj/gBwTjMKezJwJl75w3GrUzj1pvXxs7xmjANvJLDzP/9GEAu0CkD9oEReUyELVZdXsNkYWYqHT7mk0OKdHmfSAqNgceJMdWBNYVdHrFeP8v/z6MH/gJyCOfjvmFTxjDMNJyOkNVaUtuiqBWj5qTEJApWkIRPDuPMrYrfSyoqN0BGlsLOZpuhd1W24RKqlx7J00BwkWqVcWBP+Tr53K3UnVPjMOc9woh0Z5NGF4VmUVgmpRofXXu07I+pdThnhQVcjQKPLjp+aksiiLPPGeqjQDDzcINLf/MZ+PcjCAzfCTSgIKp1AQ9IVpJp53hiafLKIORno9OdRmkuWm3XsoRo+bEhFPhJnmypoFFLg7KQIhKmtmW3nG+m+RToMsOzCv0oXuAr/rj4O/5q8CjngU5fQiYnpBD29Ix8xI7GXUTFUVtqkDbcV7P9kuOz5aJmF4YRLjhBNgoC9HSmL39ItrGi0M3adExLs1+GmijShy8hvb9RK1xoOZUfJBRMK9Brj8EefxLMP7U34A+5zXQz3/a195hP6Fbb4dZHgsh7hFZW+5Cc2DWlskXa2hgQ4wDgiBm/gbWxRJo2QFjV8lDm7SiWUlB1AgajMxLjAh79LDRnkg9gzGL5g8QwihPz1qC7COb6oo6OM9BSpNNdcdsbXYePiGQ6OmqhYXZhpEIFfASR2YBVrLKRpqpWe6IaQdcRchBAVYPHJGZpCFqh0QSbpwlNhYL/IDU12Lasc1Us1710I5y1o3cwFBySRE+mrw07bljIcY4L6yV47Sdmjbosk5gOQbRHnLlC6Cv/49B3/4XIEeXoCcPtPBMfVhTfgI2oqAsFA9K8FKPUVWMBxmg6Om+hAa8topDyjcu5aExw269cXj23VhRSHkwEm2GyDgMHdWWPagPwzxQ2RxgCXLmV+wxrz0AufgoLD/wVzG/6juwfuFz0CEQcGntoxGTKsNVFLLvnove44f4SZD+ETKdkRibZhYgY8+LciQtrvIrX8VekYbHn7+hVTchJRkbfrC+g2oeIjGzGa+IMp3YhrRqeV+UXXh/vS0lqD/72Xgv/vm6D5HnrnGFglBSG93/bxnbWyKjrLpxhz1Z5iY5zegpZIZ5Od60Mmt4igm4bMa9Hy+d/Mz5v8g0QUMAmAxXK9boMrQIaQUahgioCG9yV1mJPLhItFE50E63m8bNN0gm+MhovLhyDfSNPwx8/Z+DrArsH2r+CXVDdlnwppdvN24p4fTG3vlhkoF7D0+0HeURUbV+HXbQ8ojfotZIVaTEVOiGMAHdYAcbJonqdqoQf0M3gBObiOncEG1lUChoT69g1YHxff8t8No/CfniPcl6q5u/LoqyHNNUz1G2BcXmTD5LpqzGYVy6/6C9b/LnnWIrsrqhKbZYkFvkp5UY14SientxUFGyAqGWoYjwCGDa4gcOvm+IYNLaria/34DFUZlH5e5VNEdWX9ho20aoGG5yH4DpaHvYLHcgLnpBcNF7zWAUhQEwpyxalVK5FQ8l+2oVcKS7eG9HKkaDdWlm9P8ZFKJmD64x86VqVyK7IHTQ0dqEWClR4qD/omnmWSHTqLuph8gDbULHYkYaVx8Avu5Pgb7uP4WcmUqOsCRXv5/CgehrA902iTP9f0dsGOo5gzRdZwMgTY9GRirRtjfwAZah3eCibhRJwFBwYOK0id3KiU8LTOnGltlL93DSHnzp4aUbuUL3dtg8MFjZfXYd8/QMuzf8KOYrvwfz3i8AuyOoDjfkHAW8CeVotyYk0vpkJB9gk5ckTVCm2Ji8RhRagsLipxMqAbr4+T5Z8PUq7h4cRLYNewvYZFZ0A9oMGBkeWpoHa6OsxJ4Qba1pHajUuACgWQxCPznMi4cKRAr7642POADMfc3305qq+n6EWo+3+fMRzU3D3V3mmrPS5A14L8+04eik1ba6BZc4oIFh1tsUtNHw80OVrjR6xqG/Xq6Sl9w9OAkfWvJRuGIsdQlUhBGovU8aA7Qj6NUHQS//46DX/BnI6XVgf9Vnu7LdZECjq0pzEd7S9bT1+9pEPdTAOPLRY1e7bdy0+23a9mYaQzSvgP493Uyj04ATA+qCoYwd334/Gq9d27Shi2U2N5XK1oB2U1kEbZdAywKZZ9ifnuLoDf8V5CXfArn3XhMX+QJS5taJaGIUsemZPOyVSrJbBDhtqVbxaynVeuFOHW5O7IYrlICbZKw6ed+dqc/hgo1ZKclhIkJlXttjwkMzo5jWWvMWkE0L/IiNQ0XMhyltGthrOPl7Wzc0WxjeLLYotyPlJ2OFGbwLP7hCMTmy1dOXLzz2+kHgfda6ZpSyyMTcWxYgZ1Y55TxaVMqT3RdIinyobJahjh1ogS2FZUhLvbEIaktncTcjIo9h14zEUqnSiKReExMs9gsNdOQd9P67gWe9CvwN/6n92bwGHkurJIrKr4SDxV0bkKpBt2PJ3zMljWW7+fsUVLHFWeMGfji6fw/GYaaHGS/qBszjwzJSK++iUohby4jyUtiUxFl5soGLMWGgNt6CthyBNgoF3CZ7YFl2gJ5i5QVH3/VfAU95AfDQPdCjoyJAtQ2kmT8gOdXgxfMjwouCARWusWsLRkkTlUPCDYn7JUoh+8NZj74p7aaXFKlRVKWRdjzXwmdQ60tlzVZ3o2lRatJ04+pwxsj5M/Z4PAnfSSdjBTBPDEuTnq266qm9Im6e0LjvUOfng820gvuoA4nsZ3LrLGokh6Bnlud/XRRWZQgqDilPIqmASNWto6qV/hNYV89toyQ8GJNWMpewAkRio3jWn3Kb8Vd1wGHFDQ+siEmLtMNkTvDRMfShuyB3PAX8LX8OcuE24PRB3/y66Xu1y6jbdawt501pO7dPT/cNQKjbBamb2ryNiUoarXqjgzMaoKc5n9Y028wWYTtXLA+/BBqbeGyDEWy/r5iMaGnDwRTU/GeIffK1JW2bUkEJMBZebEx4+Q4s3/kmzEuPBF1/CDjaFQDXn2X2sa6aw9ZoxO6R1Ubbadzh6wziklzkZ6ARkaeNIx3xa5GG5JWzJsEKOW0ITwICQeb05B/fR2vPhQiQsMWnEW2TnaXs12PWn9ZmucOpVW4DjSvv1AGnBEbEV2rwA530G5rKSWybwIJZpTV5xNU6PZiDUkBBRDbHdTYf73bgXVAtLZE1Hga7ECluYYSPeQwZIieAFwBLWnGHHDmKY86xYAApnEEiPEa1Bs5FmFjT8dZMNqhyEIeHfCxH0P2DwO4Cxmt/CPqY50Cv3w/wUs410Jbg2lDyVO7RFqTR4szkaE0LyOuWisUA1I1YL4VvPe13M78/BN4eZvJEaO1Z4uCtvChzlxQVkd5oF6L/JrXhtkXJcqJHlvfWJNWH1EhFA2MwcP1+6Jc8D/Qtfxbr2RloPQN2bvs+OEfICAnwGBWkEmBehtNIBXU0wC91K1w8g/qMHIBcWu6E42Y8FtDYZUVQylQyiTRRhpVwiy8oanzFZ3GAilxBpXB36wDTyQFHZq6MjSwvuca8DHcf0kxn5o1API/EYjOVE4u5kqApsjJaKsg6qYH3QEm0tBzyEaL3PiJSPvhCzW5Kcs6ar02KN6CuS0DGHEmCIfFaLZ1FUsARij7pVl2+6dHGIaTBYxhV9XmbowIL4yRAr10DXvytwAu+GXpy1WzNm2qGGpFIm0S3+nXdbI/cZHojot6//hAounGoeIDOx3SmgYXalZ3awCIUgNf6iXb7NaAOW4/BTvnum5kOgm9umAK0ZxQeiRWAgY0pSUpdvQ9jUujZNSwv/BbQV3wr5L6727TI/SqoqgAVSb19GmH7xEAUGx29ZQY4NwYjQcUkC7XoLskpgFRsWyb1UI0JGwMx1i1GhHfI5pDWjIy3CjlG6JFjmLRjRP5lZxKOsjiPfRBrQhyH0GLUutTGyghmAjdH4KgsAxCkyB0H26E0Rp1egRsQY4wK46QxctxSepdW4of0mIYDha71prIok1nSRjt5R1mYj/Kp45A+uo23JGgZQRxxSvuDiDTYwdAg6vAor3ctwxMiAo7OmQXWY54NfuWfgi7HwHrN0eBOktGDm74Zq/aSXHUjptoMDA5yu9KM6pBos9HyHvykZumf9URuAt2Sg3oFccO9TTUiPWAnAgfGlgey5a1htt5gVqbQjX34IZHoBv5EVgUMmqcmpXrlH4c+4vGgB77oFeJq1mOZB1BCtXqJlGlQvBhjkBeueLCx2JoMd6ENK88nZ6M7LpCPyiO6boWsK3iw37rRbraIu4gdjJi58PkP9aIIIHsftSP5LRSj6NTseKVCCnJbsqzsh+YlZ4eA/Xx2ERsnF9lVckEOJikjiqT3cvmTSyDmLQZbwzLL5bHKaHTR7Ajyzeap5GPDUFnZZp1J6olYcVmnf3DGtEoLKZE26wzBhRsp+muUKWBSM3GY/lCWlpYcdmii5cqU0AVBxwKap9A5QF/1vcAdT4Fev9+rhSLVdKyiOOFN2UPYBGPkyKZVA/nM2sTg4XgAXQSUphbYTh16D75NnWkEMDoAEW8g5GCTzKtNqKCqG05H3ua90uiVSzsAlTYMoA2RSG84EGkLKgbJ+9p9oMc+B/Ty74ScXAf2+6pUMsCmpgGF+7TsvxSFxdliN2tOMR2jSPeo2BdyAw3ScZ1WsaDIaAHuBqCX6yRci6Pt0NLsc9xwbtoLX+8pPweBPWsgDpdKd652K+Pom+Lefm1YWaUlcyHR4prnLGuDZONEGZHVudN95KwZic1xEkVFEcQLp+AShwWyWO67rJl/F55oRNb38DKciTVjMuRjjRANxc/sssn68IjKVM5u/ZE5a6mio5LWSqKVHCcl9KGHgKd+JfDC/x1k7sES8eOoiLDO1Q/n4y7MIbLnklbhTrvtlh+EhmV0GkoZrTb+r7/PpnDU5pennWHXchulbaxofQI72Gz9tsGpyn3aHBRVWufmJWB7+uAGKjM2keyNpdbmwMzbwA7KJRoJzXvM0yvgl/0H0Ke8CLh6b1qVkYtmurV8AGth/BL2bRGZaeCbNL/HCBeS0jEQpbtuLiutdjJ6eWoBtxupMJV9G4fjstRoXVAtQMbShWNyU+D2Yos7YY2LEh5ktEw1tkxyA98pTXFtQ5sSj3LcFsEWURZTE4jwoFJXoTCDWKi936alc7QP6K9txk7dtBLsYZOSybG0W8rdNSI2tDQJJluu4ISwIAMp2A0kwo04zSp8g0sTF4VcFMP9AXlA1z1kuQh89XdDLt4KnF5xTIAqUCIBLskSTLvxSApttjwIpO5fWi8sjTjkgGwGFktWDymcikqs9fSppIzPV7WFnVakGVSShLVhErYxWhCPcsyl9e8UsW2hmciwzS0eQmne2h3ctLkTt+TkDZbQTVzbXN1JY3r9AchNjwG99NsgtIDXMx8xVgJwHtBcvvqRSKXxev2g58wciNFco5M3q7CM79Ka+8ucRTJLiy87QCotqTEKFSnQIWoBs2HS0nCRagepyGpZQZYOJqtmNMt/bDGpcHrizUw5efQONISUF+rBFMUhTl8AX2g8eqZ5nFKy+aBj1KguxsjEGzYftg3COtw8U41oIesK3a/Zj6fKLJRgDTmv9loT/dceeDpjTNjVaf6gvLQy0UdFeOHaQ6BnfiXo6V8J7K9bnxnOMAXPbSraDainW4tBHLDgKga+AL9KEmpZhYjNITcw8bZmGM1GLZ5Zm8+X0q+RFTaAnm4Vh5uafGtk2Wt1jhFqfk+NIVQP5M3UPQaQcWQPByhunI02rQmZtuTq3aCXfDPkCc8zchbHIeHpyVmJBCpu4p7yQNaDNg5ZwZFWnx8huuQ29iqhnPQ4Mp2WLCyt0gqdhpZ/BGXy9Mzq28xztCj3GoK5lgHgilj1S6sGJa3yik95TtfVSGVRkHrydnxe5GEXo2m6KU4+pFZbI1BwqVTHCPsw5dJMeWTy/k1CaK2Cl69dOBIjRnHT0SAKRY/MEbAZ0skkJqm5ymqVX7Sf2R82nKh2JPmh4+WehhKPrB2g3TAENQIew4d6DGDugeMj8AtfBzl/E3B2xcHG2YpVrf6ZtG28LRAG6GZzoROx0Iw5erhE5/ofWHBq11RQUa03BiO9HH+4WV33/VRsNAjaNjkdINWdRLbJQgC2SkK6UQfVAUUcGJwczDwPNMytYnLSD/PA3F+HXLwdeOk3GaC77ovhELFtS36wRm6LdOH0XdTcTEVwUmAoWMmBcdqwFscSz4ZzRFcVZugRot2lmizlaI7bjC5aiAFwuzhGa4+oFK7UXRzF8jUoaPQz4unKmDPVsamdIXBGCGl3+O3cZechOyFCphb5z40NM0rMY7pSJcWcAIysEV180BdlOoqnya7lFhTTA5nh3uP68b2keYfOWeEbogcGG7RJCKqhlpTmfaGca5f5a7j8GAVVr12FPv55wFO+HNifmfinK9q0xVxBNzdd3VmHGHgD0A7+iQPCDx3w+ntJnLdwHBobJ+CWHLMJUe0VR38rRbjakoHK1acbr5Z1/OEPOphk9Nm+YlPy9zFgf4ZlcbbVSugN4wf7L/OAXL0P/OLXQ257InB6tUww3co8ota10wyb2Wm4GSPturylm91ujDLiHWGg2/MI3R48k7W0DGwjmyDcqjRCTJ2SmMDh1CQ1UdiOUxPOUWRGaiMeaaogCWxhOE0lmtwRrj2hIuZhHOm5MfpLZxsu5xTaeSxRXGujWUp5r7wxetEJXWdm1rNbeBHHz3JMgMly2JgdV9Byno0YqHDocQZVuCanP0ECCyVsIg5Zpfv5j7pd9aDcJy4bcIpkGa8+7BPag57zNcDNXwKcPpghj51FF0AqqW5TZDszMPvvrZCGDnvlzvE/8O4vtbVunGbC644IN6jtNiYpyd5rPgSBGUTmYUiQtJFUOpOPsMkcpEOlXyzQbnIC3TySinssogzR9hBMp98WZKGbt+aHuI+kdZ6ALz8GeMlroLqA4+ZnTruv1LAM2hB7wukqMjFo0Da/L5WEZXHYvRaCTGQVJBVwuDG0RV6I5ElCGAReKLkCmXlB7dCPyEz2seA6vXquaQ2NxtSNwwFSe3m4K9dEu/DUI+QCPpc6fbWPKNA0yWnOiBRS1OnH2S5Ea4B178QduPqqae2Hk4NCRx0Ai1MwNxjC4ETmtVUNHkZQlz+XXj97WJlV/WZmwXAimlSPOypumpihY4GenkBvfQzwlJdZAyNnFjXd+nTbjDN9EgJVzgPlBt4/pfnJpl+Pw6dJP6kBOdTzBjwINJD8CJ7NA41KRhpJxWi5h5tk4kPrf5QgZjOCj7+XMo+t13pAQXA/xXztjUtoAG2TQXPjCHCh7PFzVam5CG0pQoVDMAYx5PQa+GXfBb10u2dNjM0Y0A77CgBJItQYm4GF9jDY0MAEmBrjOlBWBumgNAugpcC8ImsiKgOhzA5QUd8D0+LbmcvGTaJq0AQVY+Stvm/gsWIheFLPYcy0Ja/C1ROxyBm1wcJc0vprEFS4NPyZNOKf/Czqp85myBhR1xK3LjVBSmieLdFEeTpDkNL7jyOOm8uoIbkA2h4yaSbamjPxNPvlhf0k6yZ6RcJJVxgIhBCB6PazF8qAY1DIUykFNrQbwNVr0Kd9Peixzwb21y1DzhVim8yEOI1dBBILT7knK1XyjbbAVVVqdt2So7Vu/5y0ZAlBUkeFw96sDQ2pSmrdBDfWoZU/U7Wcbrt8eHaOsR6Yk8R7o4fNGtEDG7AbKUAeSa+t5QjPu0juycqMoOT4zFjaeFEzYENhM/P92VUsj3om5LkvAb3/V0DnLlmEuXqkfNQ9UYH2bL0x0tQVqsUTICPmhKFMhJpGPmGEeQSKbz/D3azEE7d9YxurjxvlWzFlbzR1XtoJv/V6rMAXLrWfE+804/t8irNQs6q3Q4bTOdlj5Z1Zu3Q9f0p9ZzNOkAhE0OzxqZkZZq5CHAIuBFL18iL0+eGtHg9cYnYpDVTy0sx12t2zP7LazFF15pw8CUr+4AnDCD4IwpD7DYZz8RIPTGsx0PTKhNOGXJlBZ6eQc+fAz/pq6NFF4Oq9ZgMVmnNPqVGy8Q8U4OPLwO68y0ixLfkbaEMbX/9Dlo9uojpusNOhLb+uvqRGteCS8BKwFQ1J8/PfJorcmBTUHIPQ1In6MK/6hn8nDmPtw/SxjbnGodlGyzwrR2QlYH8G3V91TjynG4712txu6wl+6bdB/9U7rJodNk3qvXlMfuoAFOjYtlM5hWluTKEq73bkGl6TPDLsAyG/3TFYC8wt923fK6Gz0e1zUTWQUh1PI7BF2QVNnxt7kJeKIpfi/mfLGQdqm4SFwnAJZCcsubQhtMHNjxFUmGbyKNAtX0jrE4PCC6mbirpCasMEs0Qg++wjiprqoIibX0N4EcCW+QvQjOgkafLYiJLWEjBFA+pW50pq8slRGxUjrKMFvBxDHrgLePpXgJ7+smbkwC2zHlCekAng6DL43Hnog3dD7/6ohX3SUkm0hAM8IMarbUyRIFQy4D1otQGI1Bxgadgza+OGDLLUaW7HLReQuod/u1vUlWJE48YZpj1IXxOS+QUETm+7DjnIZkzHOd5Nplwudic1NQVokZwavuDTId0dAzffAb7pUZin16Hr9eTsGwg8QFAsRJD9HvzUr4J+yVNA93wOdHTBVH1RJqPpAqQstSi8BLH1hyAlt5tnNxny0VxgSOLWXqvZhmsIcIZnR8ToUMPHwQubUPthMUrwLIYfiUCHm52s3jpP1ydwGJo2MFZpm9QFZw6SWjQe2FKVRRKfUVUsyVFndnaRmhWRzy2xBC0RacGcHudMjbhT0dtT/BTm6jWilbBwBliAR/TPEr9H62b1FCEDHG1Bz9V6x8HDWgB1cC8TithEGWi3w+IzV+IEGPNQ2nmOG49qeCOpJYxGnvHV0EuPgZ5ecW4Ap1ZaaEBEMS7dBL1yN9Z3/Tz0Mx8EndxvybdxWHD6+mzv9G4+4pRoY/vkYMkTzbViPJoBa34veHtb58Rgtngm357SDQTQWqaR2QrYUHQdZUejmkb6DtG2wkDLwfBlrt3HIL435uhRLgeaHbP47q4VuNGyQI4vYzz5BeAvfw10dxN0f63Zw8NThAkiZ+Djm6Bf/lroL74ZdP4mO8SyjTKMSUTNut7t3dRDPEm3smcsi100Mf42yZ8z+OrCo+HH/QxA0dd75GwuZHHfAmAJD0E4GS3G5t6mLJXxh+ECn3hOw1cHu+tUVH9lZWQVN482dvS9IY3C7dtuizLHQTJcNjiL017o0Vp22jgwUCQFy6z0XNIK1vQcvywDMzMNW0WflIIwQijCKirAmXg9Aq3ARFFzhXGdQAApSHdiygpDqRyDVD36jEzRheNzwLX7gUd8CejpL3MK6t7AP0WCUYqJceFm6Oc/gvn2vwl8/lMYuyNrExQgMioz1m2MU0Y/oSUL99SeVBC6iw2QwQ+BElOOOJtGRhvfPpNodUvLpT5WLOmy6unBoJ42VQsdCJPQuAa5UZr6rWVZt4NLy2eiI5rcynNqIHNLSMLZGeihB6D3fArzUx/C8prvg976BMjJtRtktEGb5xd8C+Tt/28AK6zbXe3WnpUjSERuPsOVe+EXkOEcXMQxmU2NJ466t0sj7dsUsgqYhrcwXH4vfhHKbBhG8Lp4lEYDVdFpMKymAdpW4Q4X0jnIHBV2xuqhaf95Y+STYCL8AKDwZg/0OE4a8ViwUYgsZozRNAU55AkDWSH65sN0lA9zYxltTj4+uthY3FK6rKB7OQjlBjWpZy3QBGAwXdMthZh32+sk/3BSQGlqWYtLkDA8bfX0Kvhp3wY8+nl+03CDu9i8E8/dDLr/M5jv+JsYd30adNPtLpKaNcPts/sEuhTE9YGVdkG8JMTGBGXjx08VzokmCFFUv1q26JoU7PQiTKejA0ERSWrn47kqet5gkykGjTU1D5yvTSMN2Q8bTpltkVqKBFTjvRx9zhhfucVc+ASyArsjK40/8xHMX/4bGN/6fwEdX3INCVVqEQFzPQXf/BjQc18GvO/twMVbnbPig6MG8AV1OSjXGlHkTC7x5WL/tTDQCqJBSXWzLVZI2IjHAZcYq1d5QmUNzpSJP2G6E+nXOikvry6wov6ZjH44eNweiVVFpF1k3sY5BO51aVomE4DpoR8kWy+pEWOSiulKz37yklbKYiyQUsRcXzRPNGl2uTmSEc0RRjgFZVBCzL05LgmqTZYMrqYb71bYqBBJNL12tihBvRxHwLVr0HO3A896BWQ5gp5dq1EQFCpnFvpJgvmvfgV05ydBN9/ubKxpfeucNrOdq1NG9wCsL7fefEJ1dQejaYs4/k5W7z1XM0P1OHXS6Tzx1U781acq/vt0+teL+NdKkkTqZ/jf+X9JJwjTy+K5eT1Ga93n18bXp/AF023jVkD3/jpW6Nzbc9DVEnRnPZP4+RSR6nO18ltWW3P+jDBnSEf9PdtIGaLgSzeDPvcJzPf8E/DxcbGiW1gJyR4YR6Dnf6NTyJ1qmwcpZ+uRobiydVZW6fqOIPm0LquH1PhYjponBcWsPEbPYp8XeVoVPGczo8Rn+Gas9XtnG7GGtgB1iGgb01Mn/BBtDtWUe4s0L4YZSE5RoiJJxE4mY1hZuKCU5zj3WbQTGtYqR1JRlX2t+/M0zwAwJ+2U2kmcDjxJALHTV9TpxO7ywi0ck1gKS2iBoEi76GDQcN72ici68CP7urGDXn8IeMLzIU95KbC/WjRkldxIWM5h3vdZzE/8Puj4ktFHnG+QTLnZFGxN4qmBrySTrcwmexyZOMlFtMrIHJNJo5tmuJFi48+TRCeO3B13o6nPecuXbhZcsVHSNYlaG4gMJ90EjbRgkXIpm40bQMmGi2qQqVGQUz7LdTiHO3I4x8aI+fwF6EffA9x/F3B0zjEh3UiLRQE89vnQOx4PXL9mvTxaCEpmW4i3VdyCWCkvpn7pBIU4x4RhI9dyBeI558TJ9wMFsMnmccjZThqgKDIt6rxPwHQ2/gIXoKz1+vq4MOXeub576661D7zv4G4oQUx+cmsDMsJMkTcuMBRlzSy2kaxS4z1t9trNzjqMMjTm/UxNTBNvIEg/LWCEfCwSJBEHTSgmGGTWYUHTDK+CNPwMZlSc+GxxTkGooZgxzz0wBvipLwZfvA04vWomKVOSoGQTAwXu/RzGlQctHWau6Y8ozf/AFofcENqg+U8HgZqikKTz6ylbhPgzSlUcZXITAsCWBmCFr5w0R6DQhjsJKVjMZn5qz4mdyERtHAdgE4JKKQpiA9Ka710PVuEclVHGs5VijTbswsJ4sLEF0wA7iZyFSfbMrz0I3PVJ0G5nVUIYHISP5P4EdPlW8Au+Dnr1SuIoHDwXpiqP1Scu1OPMmsgrHZWQh2q4XJkewRF+Fx8ZqG5WcjrifTrrNdmRXGSqPBg1aRKc0eVo1vWURLXuDck9+CG9GsKlSPMgQhdqacG+5cQSPY4jxcw2yslEmXAOm7N6mXDEiSRUJ+akt3/cjtECiNwgV6WM1nb0GmWKwcRgN14kv/HjZgmSSyKtPVNveq8azLxgX9FIQERUiyQzFovsvu2JoGe/Eph7sKz+O6xMLlmnQK/eD9qfFnjods95+iqnZLfn6SHQXalxkGEMTdEX2fbEtWBjwwQlejO257Kr7hbTKeRqnPH2lnM6QYH2O3WbOGQz2JgbxoHK3aDSHH+TVhyHum/eNLho/HhIqOq4VG5im5OaZx0aryHB3wgEEYFeua9x40v1piqg9RTCR8CzXwW9eBk4vZZJvzk/9DzHiqvbRkNqkqQ4CWqy+Ts/oFI9S6lopQaCsrsLFVO8xqPUqq4K5vWpBoWsXTc2fcn4dJm4YpsnGRR8I81KyxKQ5vwdrsD9RTeWkc66tcnRWtKyhwLULI/ALopoU+bgpvbgx1BD+cOTuXp/wuVlL2rOPSPolH6aSfHoAySL183dybbZTpsGIJh0XGkqrVeiBBttPIWzPfCUL4M+5hmQ0ys1plI3YfAeuGKd3byUmsWX46chLIrwmU0mYPjDdXOMlkQcjElM1EiziYOozalrDBRe9tIiz5DaCtG46dnGU1I1OIVPwqjA0jBDoY2iCDfIc4uXpBtDk1rt5QOgImk4m0o93VqIwS3bZwTHBq0Vre0RZzLyUgaZ2n3Y7ZLQ/QnwqKcCT3sR9MpDjdjkZ5LjRuRMWLtE4BJ3bw8Hb0RcIaelyAglu+15DGCwOXmtE0qG12RWYSPn2PqfflA6IUjUvC9iqLHO4kN0E3FqkePwz02b6UlU06FA1DJ63TxrigmmlnGCugFIcJB1XfOT1gkjJwTLDcMwBacSz3WFrmGf5EQVB9yUGNDhXmbqKuRRlEwOFDPqh5EgYOqZu6XS4I1fe4/dCpOR/ujS2is50zErshm8jp3JfI8ugr701fY+99f8jpRKPwKVd/vRBfvwZxPQBB+CNd2AMqNvo++vZBztasFWQXTbrPr9QeNtBBzpi19K668br9Ks5FJ6TE0cg7aH0KoV3UaYZ5zfnCUw0hbsmV8T47ywhm/mI6sbXkypiPkGtsGBYp6ulacWbZ12ZqvRsm+6HdivTZXZwi51Qk+vQM/dDH72y21KtK5m8KIde0D568VYeDhHZIwtRpYTQ8mpw4BrGySA7n1xLgQtoRreLmlenvZsDEOrG37U76kPr7wKqHIg1Z2tQqikopuEJtsro5ypFucueDI2o4EIWZo4aylSYvOCigSVKemyUgGU3o8ObgYFMToJllvzpXOtPZODjOIn/FJ657SDQumpVd1wgmijUguQLMvNxn2JJlkiqjnKrCbWJwB6egZ67LOAJ78Iul61np+3KTNogQ24cBNw7lyQ5u19tIy2qjCouAc5F+cD19uQRlOOVkn7BL4FnVL5gRBtHUfCoShGU9QEQAUUaefPVJiHjxizfG3GGAkVU/s9fnOloKx7BU4tZprIVkHIoTWRPBgTLe9MSDZDzaCXNxmllfzH56CXbzKBFio+u+ztFNAVsp5Cn/QC4DFPtIrA3YBjPSV/QmWbt+Cuu1FNWlXD1Tb4SKA2pU8C3EHYGW/p4ptr1TEouDV92sH5RZompmPYpo/nQEjQkZiAo7E5GKjbwrtDlqJKfhWxiQhXECmn26tssiEzd12Jc3YMDzPQuU9KLHJ2a6clLQuwDEwtskESKVSsogiHIOcJhC2X3aaNcJJeak7IwLKZViQQCac7NnJKqhc52FihBnShBModyEaXpybWeMZLgQs3Q0+v3WjRGzZisTDOXYYeX3Kl1ZJAVQ9qDPBTc0PrxhGnawU2LU98aHoQHqodNm8a+huiwNpNjBKT1WcrTd0paaVdvaseplW3Xl7L4Ta5A76JphYA21Kr03uSyydRUHNxnbPUkvFefG1YYtMox55Qg44FODpqbEfdWKLlczq5ArrjqZCnvwxyelYibvGN6CcYhYCnReUFPhUVpHGBKUd3qcuf7qHRa0Hv+SHbbAjV0Kk4j5+b/4Ue7LvYK0E9DvsxohJrQRq/g3J8WHGLW3OanEiEgQ+gjgloJcIybRRXBCdFQMFj5yU9Wox485LXIk0EkBMnvhEoOO2VjT/tEtFmNKIqBTxyKa0sCUg9j802CvuDE5Iqb9kXo1QgA/Pw1BcfJ2YQBgNn14GbHwE88+XWU66nJiJpm68y1z3V5ugC6MJldxDiIqMECBOqLw6+eH9WMaJrdtqHnNqNLt8XXX4a1QemXFb8uaDGrwlMjaKcphiGPTpqWUDHR+7ZAGBZ7JbrBJ4AmBNobQGW6Yow8xbVnlyLNomZlCM+O7A92k3LVNRsaryFkll5il0EzADtjgy4FdmGr2gz3QQD8xQyzoGf/lLg4kXQPKvk5gh9ybXqU6GFM4XX2H5zI+bJEJiOUVHXz1BJ6wProeGHuE+j3CGLoqKY5ZSFHgIK3WRtlJa650HQZqKf4CKnjSQwFtDCIB01BrQXvy2FAqzpN6y1CNOoeS5BzCTgKVZKTIWendmmdn47sesHUHz9nFeHHTPc+LMhmVnFB5kowxnL0DNbFycLpfglmVSUSsQYQ+kMxeO0k5adJnlyAjzh+aBHPgl6dhWsYrh20JOpVP2qHjV1dA507qITXMrt4nB2DLdW426p3ZNgM/arbvicg6frco/eLgAt3XO02227F33Sqq2FGsxJgLJWTzzheALX7oVcewB69X6z2sZ0DnrdaFVwyMbaDJ7vkGnOrYqhBRuXIdN4SFVHzccwA0o7htDL/mg1hkutz99kyku3ZlPdphhpIvAKPbsKesqLoI9+BnByzTfDyODGpJKLpEsPeSRZl2vnKLe5YVOw+KSKkbAgz31qRvyZD9GMOMtUhnSbK9FGxTnZUmTVGiK+MMRR4lpDVG5RlGglsiWP176EUm/7JiUBEQrLsBlMugnVGJ0AumomZyMplGWwKA7sWTnkQprRkG2SnDCoCyt4sFOxtVFq4bN4gDB8LCQgZYjHTSuNRJ+J28htQZpfRppZsAJpDGA9gex2oOe+Gjg+D7ryRef9c7MTp0RZOUZJR8fQcxeN4RdilAgtJbQZvuZiJCpHV02jyAo3iagWMy+QbchIWIBHGcfUrLq1rKqDXcnY2mq5O7JVvH6Yn50aAeXxXwY88kn2tV/8JNbPfRgLDbthU2wVIFlTjEo3D+XkfaSNY8aYbxma6e3QpLU0kvUEpTCXpW3ycPfDv3AraHcecna/H3ib1MJMKOaxQM+uQi7dAXrGV0I/+UHHZkwgpqu4CA0p8ZZ1hnuWXRw8nLFYeKS9D4IunP5/6rqCUM5mDJgOnyIJGCPHo4ExGf3Y3/ucXi2E8JrTFYtCTOHAIPm4KTMEQwgRxr0O/GUuglZkGBFjSWR1aho8hJAmtO7FNmcQVqsEMkYrnEu0lIIIjrP3iBwfaIvXDQ2+kHOzm6pQbByVorXkabJRk0kbeQkuCS7+emq1k/8exkFthMkRCU3gs2ugxzwT9KQXYzqNlvjcJuCRqJhidrhM0HIRdOkWN34oWWl59PnvDVlyOLxSC/fs/oWESkBCs+3mItqk1TWh2orYmC74IJLaBN14NDIRINZTn51gHl0Cf9UbsDz9pZDdBdvM+2uQ33snzt71P2I3p01ruvIvGJh1vWUoqbYQSwp5L/VRoubNh2ZyImTGm0Uh5Ox5eypRArYE4OIl25gduIpSODW3BKIFJJ77+Nyvgv72L4Gu3wcsxwCtLhDzgFkQlG20K23cbLHiriMRgXhcmJKN63QMX2NlP0Yt9s0IduFSvFQsOhg0w5FIzORmcOJqm/cU2ppsIzaNffIVYsxMjvEYviPJgaCgLIdfgzarJ+rabQ7rL0c+J+z298XXE3bheX81LtFExWN0p05DjFuNW3BBsqNmyzLLeamk/t6qjLKlyrFfK5PY+/uNFaeiMAUiH1eygSDrBJ7+CuhNdwBn14Cxy1goVWppLnEBsbkdE4NufgQwjrcgHDfJrzR3jjjjpjaeuVTpnklAM1cw0UA/G4MATZ09F6UeKjNAO1KflNrhUxRbgOs4D37l92J57tcaOWp/FbS/Dl0uYnnBN4G/9BXQsxO4w0pqOlJrrtRCzOnAFNQ73Bi5Howew/NeJW715lnvN50FdIRJayNQRcl5/qJfCtUq0YbYRg2QGzYBeNzzQE/8Us+YdICxoeg56qUCTmt/aNrWRb6lVXv+vyflBkvnO3EfPlld0DM2tuZ2eXEZjXo2R3GkuezcaWsU23y8SxEorgeJ/Ewc+CmiWnwrWqRXid60zq7Gak8mKoOgOzpRBWPUA1cuYdF0tXqc0oEtZE7g8KqOjDgTWX8+qw9gKyjAmW4qxTuXzaIo9D8kpaob7kcDs7zkPDuDXLwF9OyvMbXZPAONo82NckPWnTMBCQS6cAuwO85gyKqcrLUqULP43UVeQspBqdPQGkU247MOjIKkG2S2ERwnf70UebSZ+XnpuZ+gp7wEyzNebrPy9boLl1bjQyhhPOlFmFgspm3jONrBUNrYAKcdeKgKg6rMhxmG1EZjLb3YN0+JwRpm2vg4tOxAF2/NHr4z6piwkYyDjIJL8wTEC+g5LzEAUdacAoTdVuBM5IBdJ11FL088mq/TqKoyNuhwv8aI9iKpkWD4EcTnN8oeTxqHnJxWzXQQBt3p2aN0JJlG5NV3Aud+KvIYLVwFObHibuYUoyMCOVmDNqdF15Nv/NTW1YA/ojZCiRFDi+Zyu/HsqVdJkge1ZFfqIRLLcL2y1EikM0uDBisFWM51VukZPPgUQTW3Ix7Qa1eAJ70I9LhnAutZUTadf87+kJQ0c3664EJ3TgZa15wFU4p+0IgpLdwBG8wuN6tR3aPqoMyjS3MW6oIfSgPTUtU0P72ekhJFuzQVHO3Aj3u2vZI5wWOXjsMZFqLbiUWMMysglIp5li4zm6ziLYkotRmOC7TgUlWGbnOOtyak4YcXZKOxAJduScS9ccGa1r8x1N3uhNY9+LkvBx7xWOBsX96LPlbTyMQEexBuAc3aPvfcbN7GUjfzdECUXepLHjqbSUItMk5KbNAqP2zl2hSHQ1LNUvmY/hbNBBdBdPJoNHjgCCTyPqQo3HbSjYq4auhhsQ4rHLGFq2S6b9h7p114DOC55pCVW+bHAnlQoQJYBnhnSjzy6NKwRtrQXNVsk7q7C4dhiHiSUJb8owFLTlum5rzD5rIyx4A+/xugFx5hpp/LcQP/aJMchC3fzzb60TH0aAHp3tsizQRkuD20esBqEmGag1G+R70xPCMlyn06SOXkm1SPg4ThWj0HvXDcksOZdfvTxvhzNd2cxm0jwvrJD2IEc050IxpEAxuzImtkoxCE2ShWigC1jUbwJdF0DV2irYeDgOYKTQycu2iVGNHWbbCFi9ajsAQqPbsOvfBo4KkvtnWkPd2oBDNGIy7TTcWWVpmTigDO92tNWLiZi1giTY0TtZyRyRWxsQ6qipYk8qTCkqn24sLJR2gMsgaWd5PX4HmsJQ3nWs1ctlyavhCBxmv3AYjzTsrbPFHrMTJmSaeryYR8rwU+4JufqHrzJMpML3l6Bnyz9fZRTGXu1dgyCS8jrJNdrtk+XEKBM8zRUw/T/T/qqeCnfbkbnk4DaHxzcovagHPo+39kTvDRJRsFrvvt6wk75kMqrYN4KoJaQ43uK7o11wwTyZwAUIJV8PdEQXHehIVU3Ff+My3gd+DBkH/9XjM+OX8TzCB6B+wuAMcXsX7yvVjf/6ug8+ehq0CboXkZj1LmMKJhMCWC0UzdDeMWz50rJieK1MXhvttHpa4EPSTngAZwdNExI3e/DYr6FhcrD0ayMFFVAb3ga83oda7bQI2gOc+w5paM97blR1u//txKwSIcyRNB3vhO3Mk2YcuK1XV1TGdkCKipbL1d0Bavln/n632GFZhX1Fmxa/PXMFxCRJo3ph/U5hMmW3JK9CBuKxUa7uidjd5vwAq1Uygz3qYYWu+MqQQi/AEaSDecCz6z6LBxoM+KY3RInK8Fya6qMNIAo3r4RvSfgGKu7macmd9lELKeXAc962tAtz0e2J8AtPP1SRsVHOU4KsZ68RpW6PF50LnLZmBBLfhPiwpMnk64oeqiRYO3lUrNKTdZh7Y2ajbcdfV8EJ0FKts05oTMoyRMwdK581ju/QTWX/9bkPvvBB0dA8fnIadXsX7wHTj71Z/B0XoC7HbpCk3ep6p/YCL1WkMSrB3ppwHQqIjrOIijTmv+ASoH/IjNpi1QM8NVL9wEnLsEyL7m6y1MpFOYk3IYKT6nDwFPeB700U8Bzk7cvKXaHvIJl1l+Df/cuTj92tie/r95WexyCYjPabxxCRBapqI2/QNa/kCyP7XEQ+5cRdqSgSG+2ec2LYkqOrxCf8N/gCt2L6zEmLEkChpTgEHFuooE2UDu05nEykSlcG5V0MI+BdBKUREnD2VYhfuaqZMz2MAWHWzopd8OlLdLy4KbAI0FEaBM1M1EzH4pSiX1A8oEF5HXqBi7qHQYuH4dev4yxjO/EspHoPUhEO+SshqnUvW0uulrwyNOxwLZnQPDVYHy/+nuz6Nsy67yTvSbc+1zIuJG3Db7VN8LKZEQkhCik4QAg8CAoSQb2WBcfob3DBTPNgyPGs9UmsGwq+rVMDZgbEtlF50xtgSGwiAagSUQCLVYfYdSStRkSpnKzJt5743mnL3mfH+s2e1IKEPZvBrvpYcHSOSNG3Fi77Vm832/zyWbkvJXKQk0oYuvEeLptVgmB0neniGjlXxYpLQEoCVcBZRTcQ5Lk+kYrI3Z2QF/+O3o990FPPpJUCXM93wMfNeHsKsK7J4B5tkGmv5cSOQHkNu/1VWFNvH2isB9JaZ394m/N1GOkfeV4kLF6Q+ulpvfYBqYO+jsdcDOGejRQwvpdab5UAkEleBPMAHz9gjYPQ+67XnQD71lDLGjsrIQmlni5xsYMS7JvhSzqgi0ppTsOjGYmMdM3OcwE5luhktwDWVbLCmGi9+nZRIqZxJWekLMRWgHhmAsbKhW6YVvwJGVmOTmKUfJnGUO5SGgfvUUswb56kUU2mwf3JF7RiOjwqSmvr8e77LkbcpTwBDgaG/QAk+ttdzyIRJR0k2dqw5ZCDQiBCGRB/BIdd5dod93L+izXwR+zG2QvkkLtJ7OrteHrbg8nXX0ag202rXW6BSAMwZqbH265mfr4RlAgWFkn0wqkFCKFB1BawmU5GVohGtA6m44fOIhkJExcGsAVrvg9Q7o/juBu94NVcJq7wxw5ixoLk5QUbO2Zm6EB0uQJA9ySZVNG+ppq3MYt+jh7U46mUpiUlH2wa3Se/vjdjboqyYNdeH0WwSxRsqvQE+ugj77BZhf+9NoVy8DbXeQp0CLyISR8ULBwvQhatXVjx6bI2BrVBFl2EflZbaMwhCq1cAOygGfVxdxEWr5OkULECxGLTOJVlXRVhWYnyZdo5YLUGGR7BtFoYxQ8mk/UyC3XGwyIpEFAo85Hp5oNcY7iWGRbLhUOcTO+lcfz0vON8WmsOSAyY5TKT+OEMtwDzIZZbSEgZxOJ5d2WJLQ+O/5aV8M7F8HHN0/KhERlAlFMbBJCcjxB4QHw44JenB+9PwiCT11aszwOYeiMmDA5WcJbX2h9IJoCGNqGlao5zSSd3znngDPJPZG0pEruIkHSccrriufgU67wCOfBJy7AU06+j0fA115EGRBJ4sdlMNlI8EYJTRTx2foGQKCAGfmy42kGWnm2ZM/sbGTpgjXCFtzDX9FB1Y7S9tzIQzR4vZfRo073HN7dAWrC48APelzgDf+KrC/k4c7+SVEFuPl/gSOKkEilGP4CMht4f69MgPdseOlzYFxAHkhXEjDkKs6fZ2nsMujwjtRPhPLzOBi/vG5g4jh+znJwOY49NHWtBBvcEoLgjrTmnHJUlSylLlyZP7FN8GZMwihRTaAdsNvFwbgcCeZhCDIt+NUXUo7Xfhi/Y+6gcmRTGXzFeWvRtIviKDTCrjyIOjSraDH3gbBMP6g7ZZhyxKvHcNrpeLbN34BE+jMOUhbgev0OVZyuojWcsmwFnutagZwJGxyeWPWwIyhhM7ekjRJtNUGHe410ICYmuwZx1vgzEXgibeBbn0a6ObHA2cujHf803eg/97PAvd8bOghpNozdZEnrkZA9oFkJEKHhwNLhx8tb1DVZXho+VDyP9bS3r62dgL2zj5saahlG5KpSLRIbXZVFekW1Dv4GV8CeeOvgec+4CJYIrlch0HBR/JBLWePbzMjmgaqe0jWqQysYxWTArBelHk1Zp2zEoY7NJGBNy748dlYiOLE13+ag1EyF6XNZ6hx8gJG0AOmcIZNLndU8MQJZ/BBQhggMn7KFUrh7y/IpGHaGMgt0uJ4Mk0BsdflMj4aTy8NAUcGIbpNMgJGXCHNbA/gMuxSDRrANlQRyUAM4gl6fA30xOcA1z96YKJkSJPjBZWH75CXkdRjpSg+8d/bN4NKhB2WCK5Uu3h/zsJWzgMy6zKs09dKTkam6JgzxDN6cE0NuDvr/N9vHicyjYzDkyvQwy30+keAH/ds4NGfA7rhscC0Oz6aPgw1/MhnQJ/yccinP4KmU/aqhQMwGIyeNmRZcx6hHbdaAdlFD6YLeGg1xGgEqXqyLkJhGje9cyB4AvYvxsFndWOJ+qqLF1mkF6pJ/JiAvjlGe9yzINffDL7/M8DOGmxpRWMjOCq5NrWRM1oEZtSWP5c6hdfQ7k4bDpu6nwE8Vqwyd9t+FIVUXUla+k/IrT2H0FFfqpnwhj5+z95Gt6IJaS3FWpZnkAiymAG4+cYNPGUI5S48VNNJIbgg7bqipnzS2TTIUm4+XujYA9xLebuDlqd+nOzil5qtPdhONh/owRiCNjRiSrTz4My1/Av6YMjro54GPXMOOHrIfqYeN+2iBdVlFL3fLFr7q52zwGp3kGd398Z2gFLzz1Rotd03Rc6cL1ulxvYwaaGVW2nsQhOm5WWpGSUeU39QiV2bIZfvg56/CfTcF4Mf+7nAxUcYrUlyCg5jPOydBXg1wjMM8+46+LFuskPG+39PpiUqbryc8mcWn8aA1g0u8WfigMxkosWGzapNcVAmM/jgrGHUEzhbuQqnIFoldjwVi7I9ge5fDzz1OdDX/yKwR4BXnVwEV93FX0Ng1lZtDAkzqz1WbhEwo0lTDv6Ct8RiA22Z8/Aw667L6ZWMRiT2DrqmxSX2rlcQHV/LVn1ja5GHofY5KNzhtjTilwKYSIt/2kI0R2hH+p3Js9OKAET9hC+ppGz5bLAHOXbBzR6SxsYKlCgL43aPfPY++II9JZKhQGTfdRqJtgE6b8dWoSU/KVOIUNY45ujanEB3D9BufTw6E9CPR1/sHITSP8ZtjFMJOLHr6CCZQXvnQHtnodceGiV3Vwur9Cm5RO8+xEjdTBuIQIrRs+UEv2zcA+hZH2u/LaNv9tKZOfwb1LeYpwZ57tdhdduLRpBJm0YVdnLFBDiOdgd4atB+DfOdH0DrHVjvJigEI/k4puHuYrQXS6QbWdk7mCQ7BYbeScbFXUlIViEiuITDRBNDQ0pQqk4rYP88tJ+Uqui0kGoZrJIDORSBzvie22c9D/rbrxk+H3CCZCxaPm9oisrV3xX0Efnlbkz1oFIL+KSy4lMiyDybv2McoNSq/0DCVkymCZCo/DiTf7ouZM7e+imV6LLiFJDewTLi1ULibx/HlG0XZey3lR/sL52UskGTRRW3uQs7LPFHW8p/VRmYR0pqZd35OsWZ7Kis88Ax+Uvs/uUMFkX3MEkpDEMrsyJdZcwLuE2DN7Bu0K0Mtd/e2WVkbfxcLbBZ/ouhRSSWLqWm2qHrXehqx26kJPaQB6I4SYjrA4UoG8OzXz3crYpr3IWY4MeKcBuVVopV4Cf+ZgO69ASsnvxs0F3vB973W9AbHwH63K+3qbfERkPUbrTPfBx81x+MgxM8wkuIMjnJpche5nLu3OOWAedWw3MEWG24zOFxoFin2QsvZZBXduFBHWo0nqXds6AzFyDznBg7xak8Q4xBNbJCguHiwykKgpBCz92A3nZGFziZlddaVw6n5RhyVmu3B+WMjZdl+9VDhjRR6lSNUmqg0xKJF+l1PHIunD4taepRXYqlvbjKJEZeGOkcUhOHofEZQy8wGFu0mPGQlQiY50RyGTghfgkqEAdf+L5/oFDHD7XVYsXUhTgF2x6I5wwN8d2qxATTKxORjCIf/6a1Gw6lnKaFQIQ8bLGNjED1oMRsKMJhlqkvmv83lQW4s7zzpi6kUFlBafwdxJA2Dcsn1bAM9+hbIImV8lRIOUqJQ/dVFqPOxCiGQyNtNz0Gyj6v4CAUw6AQJB203gM/dA/0F38YdPUB0LXPQB94DPC0l0AP9oF5M5SPfR6fR2uQuz4CXHsQvF7boUBFtFIqQl2q/NSNJcs2PGXgyuX3REs7NBVgqlUUS7Zi5iFAO3TvDHS9B9luLCCmBiTWKoAWqmpZXECGmVOMFV4gyClbELh5qmYZ5OEGbVkdeXnt7AzHiIcTNtmPC4ee1hCJ0WaIsR7YL1k/HcSR6CZ2U6tq6/cQFmZnd2T2BpXQ2Jr9nPvFqWXGeZtANHDfgSoyNZ9oGdh0u4GkW0+YvLQQppjBxQVBsRKxfaaCobNj2ilbDU4IKWwVE8YIADxN45dQAiYj1Wb2bYTtresgsTnoogzWVBfTY1QFGaVLLYMRfKZwMg6hg/OplaDEn1NBf1NRhiX/jIL4E0OyRkGUXRyWSMSXMceL0SZVdjmhbeB5Azo6BK32oPvXQS48Abo+O1oni+RS6UPr149B93wI1E8MiCLpJjSxTIRZhrEvbaoi+UhVHFoyC3WZEZlXovWpiZUn0gUD0QeA6B20XkcWRR1oxVcM/kHaYGsWYXx+XrmuV1AL8vR2yLc/vYvpLmgZ+8UjMnywKzhzKJz86xoFZFCnVwq+Wg0RnlKkYo9vIa3o1JrNojiH6HZ7o3HgyFyPQMulUyYqSYHres6g0zkSdy3Rp5LFcPl+U6Sw9D0TvctI0pE+yqPVSNuBaQi8TByVQ7rsxkOdBBufIYRWPLz/yOmwa6BL+mysdXwYZw6+DFVMwk6qqMaBE0Go4IWLLAsiyTnHImkHhfeGkYO3msBnrxushC75knj5i0yNCaVqPBvjsySbEDNafH9jo8GLi62uNBdZAwrHJWfuvUde7w7Homw79KYnQtZryHwS0lKRecxBHrwH+NRHxlnZkg6VqoglnZc0AS/VC6RxUPjvoy2ciTHwW3w+AzjD4MU0nE5VEiodursXs6RFbDH0NFLx1D/JQ3Sj1rAKO/+QFpoz1cKPWODQCpU60obdkMNQnmJ+NjgBOT8IElY8x8YjbM7QaNA2pQw6gnEzLyKH30h5sEQOfWEVJnIvDUpiJCFDkwdsgrGENjjLzrHM0NziuA6cEjSBZqdpy4QZTzQhTfuwVxWRYCoKEi62UutbWl6IqMgxj5+yA0tEIH0b6GOntCY2m/JnURk328kxcHTVvmckNtmnr/bBh0BD9dT4r9ToYl9z96yl5Uis7sxusXT3WYYO+ckcN3oL0UgcgrESdF2/Wk5iWQcWzr8YfCKCTLy8nOcx7Fzvgx/xpHFz9T76X5f2EoM+fSfwwL3Aahe67SVzIafOnqPIlNbjmjIhmh500BIaE/mEOKXqpFMvxYKraPMYQVqJz12X5bSaDuRUyC0W9uCUsVP1INAArui1ayDnOvp0fWCKRjKWEZnGcHy81E5uGu2wVQk0LMSDyKtY2BlLfoVux+XaphZJ3BqMgGI195s+OqYBMOVpyhaJPYeHY75S6qhFXJiWQ3jRAlSazpB7S+b5eUKMryS65hfR4vATyZmax1L7hNm/KUlGcoZT+vAof+ERqImUT45ADw3fdjgl1Up6h35CIfNsBGMq2gJANzP6NA0GwAP32ilqWGhKgIKW6GWt1AqUvatXkXbS6HrH2pBewhddyUuJ+aqiK69wmUwZWZOCUnDEmeVYrIgJCQ0HnY7bXGYPpsgEI2yOQDc+Erh4E2hzlIQZUYBXYGyBuz40LMK7ex5mP5ydWoZr/k2XW+jUzm4hvlv0/cXoQgX6qSWbIIaC5fYdRCqPK1fQhRuNr7dkk9JCrISH+6iLndspSkwM/fTHQScnAetAT7iow2R5GmW+y7D9VtdymMHdg5HFN/ImBWWK78CQEsWuss3P00I7PPdyBIamDDvYh1o2G97O2NdetJPAkgq1sDdrQIMWU1TxQZz72kWS7R8PpUd+J/+OFLamc84fhRPJgxlFNVZzwZf3yCL7AMKBaEosnXukoyJ07xSDNFaOU1/sRRLHgvdycGw7qK1BfYbe+/GBAms7ZvU1MgzKDZac8oJUsl2xLl9G7J6Brta2YnHsdivDqYzqdp28h07GgMlRW2H/LUDUQuKJNaF/Zq1kIECXnDgoMG/Hwf3Ipw2M+XwUMmWlBpp2QVfuh37qD0G8HiVss/+7qfzYTiGRblUDZyClx5RJueW04MiKRJUi8zGrs4h0d8MTEjPn0tthMWeoTsDZi5ZMlHbpKoVnd8IZg4FqaV+komoH9vzR98ZNCwh03ibau8syY8Hdgs02WEpgmuL5TgObQ0aLQM4H174J8WuSCNymzNPkkv8g9fdpvv7eI0OR7BCLAiNEVXTKZZqkqdFeWvZnlWNqr78YWgAq3U6b1goKt+AQKRm7rJE5qSxpRny/74x7skub88Q3cLl2SajoahwSNtjOG0+dOiyLfpcwhC3OGRyDnGEUEWfwkSuvJuhdHwYf3g/a2SslN4coI6EftNCyD+x4UW15MOn+BdDOgV2crYAcuOCZOS+sQD3VAWEBXrh0VFECMikzAPz77FrMJcZuVKt8fJaxPRne95ufZBz9DpqabXwYmNagz3wSeOge8P55O8TYUm4pBrVAPnS5HeCHpQKFE63KsmOjkjmUOaF2k0sLIrCWoMugEUOAaQXsHowXAcvslsqRTDmAZkgJsJAhU5uAowcgd7wHtLML0W7uxdHmiD+PBcvObZR+0s2EROR+rUyAip9f4iBxP8kQFkli38gHfV7x8XKrNU2DAeD9u5aw2Trfs4tbrbWs2goUBqe3ui42YkWZ8CNvHS46jnCBudrM/OjsYaJ+G1Mb019XKon19Y7osq/BJfJ77MY9z270XWo9OHtKS9B5kYTYUCJatrtqcY/VtYgm6FRNGXXmAPTxDwCfuhNYn8lfng0bI5qpJC34sBvFsOahDgBAe2dBu/v2/TQbgDmJZnDklJpFPNFSvGOHiHD64yOMxPgFUm/LosKsYatERTTl8wEBdN4AF24BX7hpQD7RUsfQ1gBm6D13grdb4My+/YCcPvL4O0Yst1JyDNOCXFmEEg9s/r6WIWfJj9AUQvnf4TDWsiojJ+uudkF7B0OEVZgcaoGgIpk36L9/UR/oWtCozw12zmH7gbdj+vQnwbs7oLhAEkpDkVzco7LxByHmELZupvq5+EwEkvH1lGnR1esRG6/68zqyjqo/xobf3CxsxLy1NH7uQJD70Nxdg5RQGJ/hqL27HNy/0odJVcJJwX35i+uqwVhfmOjCtfDk0mDJtRjbqVTWXwVcn2uQoK9KRBq5uIV9beg9KEqQibUl2n3daBkBcsrfd3QM7J+F3v8ZyHvfOD7C1ZmCLSvBpKg74Xzh1NdIXHLad3ahO3sFC0xBIYJrEeyEHu8ox01Pp+TQ7np04dMinZfrLMAOZHW/vhbElf3vYhnxj3oKcPZ66MnxiG/zEIm2A752GXTPR0DrfYNZrEF7e/a1/YXEsvKgUglGDnUlFesS9CH50NefzTl3o7QuUWRt2R6BRwunq50BYXWfSKTn6qIN8EivZaa9V6wdTG34Ad74S5hcMOQEa0lcl9q2K6PZZLSxzfQkPVs+jXlTqTIsnyHixFvZOlk7kQwKRPp0SPVMGk69xHrrUiodVYoH0PplVp/aVlpJz8kY0FHNG9T7axh7r7i0yCmjc4f0bpZGZDlMGIIS7+NsTadMwOSWSfdJ580/Jvu+TybkVSsR+TRaAMl8P00uwfAeeIvEGViilk7sduKaYzh30P5F0Jt+CfTx94DPnI8XlUpuXJ0hKZYDp/DCwtZRqz3Q3rnxn32XTwk4jamiDyfHAGY5pCrR0bnV4tQVoKz4i8Yr5rpS7JCCEW0mm8HOe8RT0VfrMcCMF3sFrNbQz3wCeOAu4NwBaGIwZuChB8bvkzVSmagKuoqATNw4RqlcZOUh2uL8+TVQa2xiJ3+pOM1kJf3WSUOR6dg7sLMe2o/erdLosQen5aQmvRpeQdhnO/ct2tlLmN/5WvAH/xPozM4yZzEQ6B2QGbxgIJaqOg4hRCZEDM1BZbaREXPpfbCLNWjWmlHpPplzAc88ly31EvYagz0tyLnUChaae/m6Pds01gpj8D4DPlDLvDOdxbTeXDhzuU/V2T7kPnBFajhv0kFB0S6goAtXDnvZCcuSLjPKIva4+xI9fQr95BbRyv7W3B9yySfE1ICTE+DgHPQz90J+6V8AmyugvQvQPtul7+WquJq6vIClpTACq6iO0vTshSK/TKEJKPP8Ik9PC+e6+NnzgOHFCb/A3C4m7xxfMxBpKIOkzQa47hbg+kdDN4cWuGkyX16DZQvc8+Gh59jdB04eQl+toJ/1fPRpD9hKpCQtEo2oDJlOfe5xH4cRiE79bJUwbTdmmXMEEs1LWJ9wywycOV+SeDWn/2U1myDZOj4dF9283YD2r4deuRv9F34ME8TmIjU/YgTgqnpLUGZQXNfDY/0WKTx2kYpkSxlrvVZWvA5Cbd4qIzcyLd2BHmWPie3j989MInMiJNhVo9JlQRcaP9OSbOXPD6PEqaeZJnttFHmml5zceOwi1QMNJWS6cRM5r9wTSC0VeOEQq6oNKbRSVwki48L8a0U+eATvlcPEDDUcTHREhUAoWCdu0JMt6NJNwNt+G/Kafz5uvvX+YAOQoJw6yRr0FabfFE6A7QLwGnxwMfFpRIuhF06nvJhIJMC9EdqJsubhLIuLeWbsvv0FyADUcGYyFz+DADc+AbhwMzBvQNM6v482AUdXQPd9fPz31+6DbBX0hd8C+sK/gN4J6LbmpWVeX+YUaoaOKhZzCBR9f9zujtiu2NcQtSCTqBfbDyQMc//SeFdlHvZnGFcyBG0aXIWKJVco5pMT8P5FTJjR/80PYrr7TtDObqDKKpAVfm/TlOpGpmzhyvoabPt/XZJ6wj7HpxJ6GZHgy838CGafz5BRiszBGDajhMv4Ltzp2FPp9WmZkTjaWCko/7T5c+TneNKO357OOheKLD0nzRJaMv7d8tg89cc0AxXiwGUd4oIlcVyVWBYaCn9AAuUNKGQWJFNBisPKrcKcij1fI3EalaicvuqiEK9Zz18H/PrPQF/346OPX52Fbg5Bsh0qKR2VC2KIVOJ/7CAKtsHeeeg02UB0QnE1p5uxHIJhLqJsAUdbUzBYJeiDlMpLNuzRi8zDmks/4pGB9R7opseNtCPpYJ5im0NM4Hkzyv2r90D2LgBf8V3ALY/HyWt+HHx4FbReAXPFbXEMXdjitKsEgBYJz/bCz8VAFpLg0ssu2N95a6UCsABazl0IFsICe67AH6VGGDH0G8yzgA9uQJtPMP/0PwC97fWgvb3UV1DZuoj9bCYXd0luVCIl0WocYG0Eb3i751Vy1yLZ5gWvQMsuP1sFSoGPluGmiUGIBlpOpI8LyrMUTbfDSGqVV/DSe2pQuBzQdtlM1WyBWNN5b0OhvhraekQfq1S2A+SOKCwCGkHNgjupBv0FzDJu86DHaGYBLk50W2g5d7D+1gNZ1RLSosOOq2yce1vxRaBCJ2DF0O0W2N0BU4f+/D8DbQ7BX/ot0LO3QK/eM1qD1qA0mUSVImNt8f37HnznDNCmIVJZTcMbIWKZgKWSklPsfmSUGkneWAsySdiAYZ4LhPSZg4qLJDIxAccCnDkPvXTLmHDz2mYUMjY2fTu+56d+EfqjngZ6xlcBqzU2v/zDaHd+ENPZS4OYhAot8bWjI7Mr6YaC/DPswmVC0XtpTRBbIGh5kMFjuGZiICo8PXiQ694Zw8/ZZeHYLtJig9WRcNRniBJ07wza7jnwpz6C+d//MOidbwKfvRTJVels5MUNHNBSHVxkirI+Z0weFDvwc85PKMo//77dWqzjazp/ww128Xowx7+HToM0rFoYl8mUG+5K/7ud3lWm4lYZiCx/f8RsMyoLB61IIjVainj6j0rMjHIn7pw2tudJYtIeK0AfBiqnOlClBHcaZvqU796TZNUNMdqGP8nDRwr/LICQvm4q4aCICS1C501cWGrOKdhsoDtnQJigP/9j0E/eAfqKbwU94snQfgA9vAxsrhllZwJ4MumyX3cC7qMExc4uZFoPnp7JANXWNGP3q2UKbrIjUhNeIbOlXX/AWuy3WroeiqGaY6Goyq5NOQdiaJvA08q+nRaCHhKgbzeDefnMrwS3FeSeOyC//OOY7r4T08Wb0bcnsfWofMUxq5TUITAeFgkGI0ZXFL1jrXxwFo5SOyxoMWXzlWAKedzXgHDmUbrbdARgwsQ2aGvgzHnwtAZOrkHf8gvov/pT4LvvAl280Z7tObiU1fIc0meHb7iKlbWkky3dpBBNzgFprNlcpanGAfSb3+cFoXeoq3Y/9Dm/XmyCuC34iLG9sEuASjUVrWBRZUIxKjobvk9k6xcJPFEfzH87DHwfSbFXtZKFtYRfGoJKOrRLZLOlfViTjuKOr9mEOUG1LTptHVHgoZgSX+tpJjMZf26AKIaGgSRTaRMhxqUySGz4gvJxcjykvPvnoL/zG9AP/j7oC78K9MwvBW56DHBwYYhpticDnSXdaLEDuaU6A7KFTrvQNoE22zRaMi8GhxlQqllFFX4dOeiRMg6MzASkzmGkxIMHDcd9MY3ND0DAeg84vAK97y7wLZ9l/WzONHi1HhyDzSH6u18HectrMF25H7R/AbI5XCDQQidSA1tCc8DZP/sBR8t2JXQAnDedl/+qKCV1DnyphtOIjAN4fTBoxfN2kIq5WRvWgGkPOLMzeA8yA1fvA+54B/Stvw5599vBXYDzN45qxKLsktqTa0kxngRNDJl1HKA62q0+2/ZGdaCdfADrvD2jCBMwvg5hPKPqCUGF4GsCuGE7SOy4GELPL4U8GDgo2oF/75LzMEOfU1QuJUi0HGpUgIsTFr+wRajx6GuKyCRO3BgKaVJQNUaACTngQivxmGnktoGQf7byJn3dJNKDLBtBHSKjvCeXURrkQRTKc6w31EJHc5BopBlN1hxmtVKIoMfHwDSBLl0PPPAA9GdfCX3dz4Gf/nzgKc8BPfLxwKVHQHfPDjUaT+NgxBQTf77hsegXroc+9GEwnbGY6XL9OYcpchiK6QUcPH2/PcMEVEbtWiO5Ak6RWnOS1BHQtIM2H0Pe8wbQjY8H3fi4ZcbofAj65Psg73498P43YcIKOHMW0jcJFelaSD5knz/FDEHMsBKKUCtxUcJmUymHhWBmeE2K/0lsfx9OvTJQ7B26fw5806OB/fPpueAUeOHkCui+TwD33w25833Q978ZuPMO8DyDd89B99bAyUnIvcVdmLaC45K/4AM3miY72Jp974JuKLdxixvBON6jxLvXTYkjuQdDA1lhCC3nQ6ABBHH5OY0Km4gWyrzoVFrGtil8ZdtKNJo9R56v6Ke0S/Xnv/SNSo3Q24AgNrvJfQqa8wAX8WTGPYV8X/OhlZ4TX7aDxQwSIdd0CbGVotq4BIfqQulHkAVTcOCZkTRVklxhRrCJlWONRwy0X0VcMu65JffN1zuuNeAGbLfAtSvA4RVg1SC3PAJ41JOA6x4NHFwA7ewC0wq0Gm2BtJ3xS7zz/aDL94J212O1ZpWO9rmEe+jD4BTxvQXiyfp0L4+xDHkgJ/KaEjGddD6wMivxBOjxNei5m0FPfQ7o7HWjXDy8Cv30R6F/+C7w5fvBq72Rce/1qRFmnVzrc4BRtnJkQ+YeutCSmApghSKlKYxAi/GHBZVIlRZUvqDHXtt/97Rng3Z2oLweEmYo9Oga5IF7oPf9IXDPR8H33A196BitrYdseHd3PB+bOdqWgJm4mhScLUAQeieT/7aYcYyDrug7CssRjgsnTsWdPYtiQp4kKFmrK/n1yS/DBYC2D1RbHQBDISLj8isGLZXZBEstE9i0pKlNdgFOu9AHPwN83peB5r/4jYoVQyeMgY+4tTIxytwKT83LP3JkGAo5Zs40Uv9lN6enSCCP47Ao8sZxu29zMMIZMz5uNVt5cY3ZLjnzDg+xeWDGVVckdQaNjhsXSSxSY/WpzTS8rOsC2vaxQ99uzK+9Aq8bsGJIa0Bbjz5xnrF60jOASzdDj67ZZyHDzWXxWumGQxl4UmYdVIU7tVTU1SigSN/ShTc9SlfvHT02vTXg+HDIgFfD/ISTGRBbC7b1MMCoxO5dFsGoiDATn+sEIVrSL+8qTrdU++GVhArHl/uNN74/ppL1CFokGo/ncAa1HeC+uyF33TEqD56GhXplSdab7TDC8ASadoFpbeDTHjt8P3yDg2nXqI+UZZYcktU8Quacv8wawzYyvLaH4FRVIDpiaFjXPGrI8Mjbce+AVxwR3Y1FNqZ/CTZOg3jpL07s6pC5D8Gdt9XhQ9GcEyjAO7uQ++6BPPfLMJGV0CGvLVlyznETGS+F2bLC3aaqQwC0qpFXzeTDLiAacwAtpxCRjm82kEdGHfJyd5EQq+nFnvzGHOXyMIRQQXHbL8mCMIIQVF0pPlwhBMp69GEJuVB3621n+5EasHcOdG6yv4uBVRsgkNYGlokBOjlM8Y/nmXk8WOUPouYH2AQ/Ai4oor5Hh1RspL4OgixSZYhq7Fay+uKQ6QLaPQB2BgmIVIEzu+MBmrfj/xdAR3xvi/Sakro08s9MRiIhPy3Y5ICgRuWmyww8HxYmHargwyon3bMfV+NAazvnoKv1cDMoAespSUhzH9Rn7ZDNBipb64VpmfSkZUBsoFk1jNxIup5SiNM8aptto8NFYpyD/0o7GmtDTdt00Hs58/98dhVRXxwzlhqcMlrVOj/RENlF5MQslrbNESMXMeqRxUmpdixCzmn8YluYWNhVfw0xlFITNnDjJV7J5Iw6awI1bFqfBpXB5qMYGrKV8cXyq7pgEo4ybZt9mfVY6sw9sp5mvOWLFc6Y8tfIqhItJvYyi5pRwiXNHLSdGNbZKeJmKSUZQhoDMiyEbrC5xEyQkxPbAkj4GehUpmDu7DW3IgzTXtAi2toHf1R0W8M/IObZMLosaYFdJBuBnPw7b0OBppaTRn02fXqzHjFFJEwZWuEvAhbbHS1tGEqkGsWAUxWgrmVFh0VgRla6MgaXvgZFiSBrlicpCmzn8JdQsxZPFMRi8dx9iLLK1scHcWQH/jhwXA5tF0ukUvsLZ2x9IygHvNSHrmE3M6gqTXZhImC4ZFHbahcsU2LyySot8S1ba+GT0TJXixwTP2CEokqLFsuZE0KR0hxtWIH2xPbIUP8+02GNdNeWDP6WCKswrXGLktX7oFh1uK7bTAc1k4487cZMQ+ijVMmvIyGmCZhxd2FDccWh2GeNYJt9olivT8tAydhmYJHoqup/h5dgxgLwk93Yber6dbY+z1JW1IIY40V1gutkiFjpES0d5SfSKgrDgIXRxmXCjdMYQym51opiWgAvEswiNTm7UF5CwRiKy3FLxk3PpemgfPkSsezR6mNgGunMxc+f2wDEViB4+PFAo/gcckAmMqoJ9zcoF0JNgauiUbBbBjHaVqvaw16bTlUtz02BsOgQlXkmAZ3inLALcpgWQjpfr0VSQCFEB6qekiGRkvGMhaPWRjtstmePPGeP7XJvjJKFhyBMXhQ/QDfVZdVSoDhy7fftsWBekVT5OC0jyTjoIaJgwyCnvkatL6LizOLQnddkVBcOUWHmJSwlWwA1F5Iqx99DNg0lzzbv3VBaPOKo3QziO9kg9bD1R822fh7NzAULzgOo6GIS2z4MziFFdh9qhDmnxp7c863Z07lmfZzYYpxDgly9DLr/XlDfDPffLGG4IM9p871sAaH4Y5rpRmUQFWGqZX2EobtgmFKzxlCHtYAWLH1Xi6kbrGqQac0qtBd/3PppH/VbMCrzWEtS5tNrJttSaDYoXIVR3Ukh41b0ec+WQCmhrjCuIB8dgnUeq07D1IXzz7XxOlpFl+JS0TAMxJ0WLoCRgSX77LH1Zqv4bYhp8xZ2g5tmGtZA1xPYqk8PKmFbwzFZ3oJdBuzJPr1U1HZCOhzWqz12NoL/d/55iaPSWh5UZGt718c5HFdzAB6iNcvnIDYhUPRFITjIYV8tzRsZdy7oIoW4Ell5HPbG0as45VZSsWd3XgjigqRrExWiAptUm9r6Ld5i5zrciGx9DqXlVqqslOND9GaTkOReFQvr8KTVlpnKWhlyXjoXGMCIYRrls1y+jJkaeGcX7fia7XEtFNWrpLK6ymDPshZDiZzyt4RbgWZmyi0tDERF8FRSlxZ2CyrlQdEdLFhHkSJc9saeSFOMbz7jj3aJErQB049U+zCKW7DSarVMtV1dmFZnCtfiUKIq5uMN+OgacLIZzksz8bCBa7WXeHSq5CyNUt4PBPVbuSQRJcJsVMS6Gu5Xfznr562hU0gHo8xiK0FeHDBjFtRtsGgvLWuK2ko4LrsfgJfBKk7Dgl84PjT2VkZt1qYtUoZQHZo1IK2sLadoIrhIFSOwgKPXy4l9Gjqo5S4avdw2SGKqUsJFx5rS4IvcbP8qsa4ImKMLHtTx0gWZVQIVHdJIUeJPMXtzAZCnBFW6a/6FGio01IeeSwaew059RKMETJROvC7AdgZu+2JML/gLwDRB3vDz4M98ArS7D0JPIjCX/jeCNClzAJnL8MZVjmRzUV/PosBCa6DKeKhhn4mSRVpTCU41TkMAI11cIj3TaLuk4EiKHp1KFRB2bufVIybscd7UhFafCUkKgCQORnpYAhA3hna74VYEHG4htz4G+rlfPsjF934c8zt/F9O8HX061LINDZlt358ju+CAWrjgbfy9XZJy7R+meP4DtQUkx8nWybLI9YFvMIg1kWMRpaYmjmPAw0MXvgPjVE+ACAfYg9iQYwbaVXD8vvI5dWCrSaMxLZOsiIvL3BKJm0mIVSHwA4CSxe/YIWYu5NRhKshVWkFU1yfFdv0cLxnGC+CltUM7FgmrPmNIzJcWoUjYfn3n7FNy10t7aV7dV626Qdh6J4KU3md8OJIW5ELvcUyZD1W80mCf6Npnxq1Brj4AffZXoP3F74XunQf1LeSDbwHu/ihoh8dqsQRXpCe8VDigAtxEEHnGQZd5gBnHhQVOO8nH6UKMkx41MwCZeye6cB2GQMiy5eoLWRNsY7tgGY1xWCwy/poNYCXBL6b0obLoCNwb5SZgiIgobbHrPeDBy9Drb8LqeV9jw9WOefcfQ37j59DOnoN6QlCMRSSeN4Eu5inxAjMsRTcTmuL7d09AT89C/N6cGlUj3U+5/VRkTOmtAuQov/NMVD/4kRj8EThbItlrbF6ZO0T1UWXvWCYARzVW0qW91eQitGJPM5EFT51LoGI+TDFlNDoPiYYskZNmnCtANykkh3XJElBDNBFBeoFBdseNLb8PF/lo3ev2YodViam/2rRTpSdJJSK9dJk7QMVAoafy5dj2p2IyW/s70RrQj6DrNfCsrwDtnYfe/1FAD0HnbhiVQZ9HLDcZLk3cZdnCFKUyhougNh44l4y629BNSFYxhFOuJJcO8KlVVdys20oMtxY2gYItAJNL6lGzz7qEjbQWQ1BqrZTsnBmE8FWgswpbSHOHOaslxZnbWK9Z36zaYk7gIBfy2RC3IcJp6/HZtTXaxVsAHEMu3wXVGatnfQl6m6CbbeLZNXl9aonQDiLXiokvoRzNKlNf/Xp/TkV0FuV3Skxz42TP0Qi0ySBRtblaGHeorLoNVFK3ImLDXp7G70Bmh8ia7Fx0sT7W0iaGGAypQowcwYKf08Ke8IUP520+DBV+84ufbqGOG78YnjxumBKlLcs1KyQ13KKwcs6owKI55QSgaNaza9iNvY+KgVscHJQecy8drdyN4B5esvPSS88g1oxqknLLlZQbLSReteEhebRY75Ebz6YWpN2zIxgUijZN40N96vOARz8Z+tB9IJmHBp9zs+Arqnwv7Upkm0HYtNZR1AoFmg7tuw5WgROACd36QgWTFFNFEoKGJLon9TZLCFv32uDKxFlgD1cpEIlmIpSQUlAenOX75kBi6QiLZbJhYjX7lEuCMvFpHCzN2jerPB/8DOQpn4P2lM8HtoLWVsPFud6DTnvWo1e6XPIFsnIp9CUX67QWm61xmVmVRznbGACcNuYLltZLRMEHdOnvIC+7ejpFXXXLYtEPmS4tRrqeqAjCEK5YuH+fMhSE0LJNFD+4l1kZZCedUiLrxEVBjaJN8gdw8jKGSyCIl6xeXjBzBIHoqQkTeVRXp0XvjKklGdUUULRikLSI2RopOJq2yy4RKQXqww5pGgW/3akZOKEvJcI+sxglWGH7u1HFRErqpxVTMbHY7WM6A3XsuFUxg87aI3knh2g8xEi6Hf2jNvDxMfTs9cCXvRz6O78E/fgHwP1ayWf3jQmXHTpFpjtqWV+Yd05tEbewlpAA5yEopeEkNjfRo9YZhGt5dAE9BTHYH2pfP0lfpgGh5hdkW/CwLACvqKpN2YnBnq0QMxhDVrUJoNVwgpriUp74LExf+A3Q3R3g8H77rFZDk7HZGAE6beShVzHIrM59VDORGF1UflLCQ0kHx98OsBIGZi8xJ7Xa/A5avTElPXhUqAyesmJ1wlUARd08BzaPjCYHI25tDrQeFR63Gv5buh/CfVR1lNqXaGmo8Bqj5fCfSzE5aELIeiJHMYW8FxBT84lxw9ktuHCnHkW8tWC8pFy46yEX7RIBnB7hpb2H55poCj94kEwkHWcLiipRwT9xzhCEM2zUV0OcWoUqShG7DTg2HZatXuS5A4oyDiNXIiowxD5tDbr6IPTyp+z7akNPf3INdMNjgZf8t8DH3g+992PA8ZXiOivBDiUs0kGjKGkwpmwy+IjhrUdZZfVbWwSRZDoxEoYqpxbePsmmh4dmZBR8MuaiP9TCKih/jv2zZrNAL2g+D9f0w7FzioBeOl5t4MjboDVf/wi0x3w2dL0LHD00toKmguv33g26dhV0/iKgcyLsaQjTwk1nYZ3gzNnzz9BXn4N7SwU1l2tUD18FmfzWSu5QEjqWPgaGVnxzSe91MZXrY1obz55Ji3Uqvqe2zCbUbkNcShR9gHBIFsG1HDt+/8ZbeecsPZiXh/EUllNfNViIIbupRnOannhtWpgh4J5u9Pz3gSGl9YGWM9vRM1TEb4+IkmLzvScnLdZkNY9PMcrqGseMgsWO8I38YdVESIBCLZIpZMZFNhvTbGuQXFwE8FA8Ntu1b7egnTX0yiH0D94G/ryvgaz3oNtD0GoFPXoIulqDn/Ic6JOeA5LtEjpJ5cYqBxRpQaAtvANcbHy1f8wIsWARUjnlUX6/pzFsiiVE0xdydIqEqovYxACSuGZdfYhcYsIoPABSDC5SMhZzdakRMW+HPDeAV+NA3lwDji5blQNoa+A2Qd73NjTtltzjKDkPLEEIw2AwjlK/2DvCMYQjq544DE5sFVkRXklmHGohT2Ve5KgIRccLO2y9FCtmlOBW9Sj2lcm659lgL5zDdCmg3Jj/mC08sOGcg3AH5fSynYvqDWnOK2vtQQQKekiZtFMJG7QfZpQxHGYe5ZZR270bbAJJHUW3UmocKjR5ihBB0TJGKazEPFCHrkSEhLNNfV/iSPKpWQvAAJtwqOyw1dO7XALdNQ5GYCi3yKO5JEVG/nPHhLdnzHm4EH3a3YdXgPfOA29/HeSpzwM956uBeTMOvqmB5hPoyaHN1nwfIwsMWN7MiTBfUIAiy00Xcdn5VHOATD3i2r/negO5zmM5rMmXVhdcTSkodD2lJViaWMLZViqETC1SnNp3FZCoJp6teh2IbY1D5TBaQSGYoWgH12P+xLugb/0ttIOzYfapN5sGY8/kyy4Kk1Ftcl2jlgtQVC10uP7fnOo0VHueATBi6ssUnlpUm07SHxIASYkvEMnPcQvb5cWRf+Ainj4qgcmUi2JKSNUQCCWnwdWxbcyKei+5l7T0wVRmoEoiwSJQs+Q91sDFBEKU+GW3dkXCrndNPWg15FxAP/U4ARPDR2CcANZlq8CZOMOmuhLpECjYgxbil9RMzJEnt+OiKQw0GgINJj2lujuFhC68hlBh9YJH8/z3zRbY2QEOr0F/9l8A6wPwM14A2W6gxw/lu92Ph/w2MF8IHzjKz+kvsybYKvtTFDBqZo8PKIUTg7oGWy5yAZC6jCjlF8bCBIzXUL3T5qWcE9ReH7E9WcQDKsULUsHlBF0wJ8YWiBa8++y9G9AaZFqP73PnDNpqH3L/J7H9mR/BzvEJcHAG2OjiUE99hGUyuDYCtVJsER4+5jvNVoJ1HVsCOjmVpeTrPenGrk1qsbKTn3VxtucQPdehakGuMUuq8fYOf+Uxl9CGYfWdKbUIXQMCGg7CmrWoZK1KD7ScCKdwTMMMVHppn35ySyONLlWCYp57MuggcSyCxp5dpHDcHJusYxPQOF4ANzqwqwSF47IdeDWf2POoU/yJ83x034MCS8BEgYmmgkqXGVJcNfWmAvR1jfMHlMPhBReQkC7KKQDAZgs+uAB96H7IT/6P6H/uTtBzvgK4eGO5ac2oglPBlYLFkMlPXQrx/B9zOKHQjBa4oxrzfAqP6Wm8JRizuE4XBNklXyBls6dxm6dCEiyYYnkVoMBk8ygp6bmhTeDlZ+M/i7dfh5cxf+jN6L/yM1jf8QHQuXPQzXaBiffZETe2ObMuBpKpjU+vAU0mjGltHKBIL4G6BsMpTZYXMe6jlrqV+KBMwNZMaFPmEvFRec5mK5xKtZbFBsFB72U+RUoGpM8Bj43kaPv9ehCpX2rh0C2JVgFesQNjSj95IrvIY21peLFrOk1AEcP+W3zjKtFNkDur/EVzvJMTgi3EEBjwTjplAyVPtzF/TapwW5gdMqc+2W0wRdh4EKZ8V4qgRReoLZSBomXdkRZwKsWLKs5KaLwwteDkBHRwFu34CPOr/in0bf8R/FnPBm66BbratT5V0h5cE4G8X6niqcYxsExsWMnBKpWEIvX3Etly1YPOZU6CiN/ScAaKpRQVqbE51sbgKgNNvRdWTqVbQD9LRaDRctBi750rVtMgsJZIbDN4QRbJUXp0BFy+B3LnB4E73on1SQcdXBgpxgY4DRen/5zKsXLUErUepiyXfBRH11h7pmQ4lae0/F1LEVURlXOYo5uuysKISMMINqnEpMTvF7gpNJgaUQUWq7WaISjmWqTVxTX+xKygyf7eoBRTHhacluApV5A22ZeS16Y+4dXisBLbYnGszrRQbd1N52aIREBJXE6DEYAoUdh2ziqpQhyyV8rQhPx0x/fEOe0UGCMwbhyK5FpVWQ5uKJlq+jCutIbiLtRdWqbLC3RaDF9HAs/mBFjvou3uQ+/8EOSO9wJ7Owjwssw2BZ/tpeb0HoQNd7wwQjkM1NqixUZAlkEiMIiqqbBCWeieDKRDLU3ktvlxU0ucss5KGN+zcqLLNIw/EoaSIf8Vs63SIsWca3iIo+CJ06OObMXUyuJButEIU9bewX2LFa3A++ehZ3eA4+M6b8zzkH1rJXmROTUZkmV8s9UpO5Gq5y2bZomFiMbnPvAW0MQ3IVKbx1aGyYJDmUer2fuoGnZaxnYrB7vSBUM8UUTgUfGokabpDKpoNI0wKs3WTmcFJk6wLOfLrg3xXA31Y63eGJNHdRaTf1m3wYI28lDWzkkFdheXDBUE+cvKS0263y6sHOW2GrSDB/I3dAT+0pLtRlOiSBFDFqmyrkwLDwPZQK8oat0NRln6EiwvrxHUdAZBpw0si5326cEorUZ5wYzZhtaG554VdPH6Mes52Q75sI5BFkSASSJpyc0c4nve1jIyjU+hwxsWfns3FPmgUovPPo60XoPD1FqsnIXAKDGjsJgCkBESYF1H8hmVpB7y1aojsV2tZrOe1mFEYwoAxijlLWehcWTv+ZXkl87gMOj4TBnAqgHrCUptQGROjuP3KOHRH6KhcA6yoblagkcdzjqEN5S3fmQOUJHAm6BGCwpPkfyFNuzkVEQ6KdutBq2SdB3JQ2p8AF4Ib8c6/VRCFNJGHqMb992ED8DShBQGdoEpN4vkJMxRRpqO8B7F5Plko8dPUmr0GBZD5N5qDeGJxC2d/Uh+YBK4KIRHH4Utp9FrZWowFTFSHVJneVn6zp4nM9nASajc4M36KrekxvZMk2UXANGk9dJiZUlVcZu98qkBXiYFDfgJDg/HebVqmWqMBsxl6bZqllyLxYZCMB56MrUiGtv+GIVtyGG80VXLFSGGsERFxruwNglvn3OT4LLf2GY4TWaySGwrQSc39yhobSWkq+hWJo1WGjePWgXhaUbT+PpCGg+jj3NiNVfShFQ1NA3UZ0ifoTz22jILcLKJIogLozBCOlzdqdmzs+kAwscvztXnRTDJGL558KyV1aUNqNFtw6lHgWyPitE9+oKl49Blus4MEARoR+3SCLCOJgUoMONszkofcFK6QFMr04pV2xkEib5TSech4n0rLQBlFGvhrfsFR8tEHaVc9emp4Us5vTQiu/KFVNYh2/RgBDhfoKb8iElGKXX5fvCYtNjz1FTEfNZalG+FpNJ7YrYKdTgkmAF5q5jk5LbHikUytLQSjMgNGN6jdQ3STMwWNnOuySLE3SWeKKKTEmWI4YUIPcd2TqWfVxzVWNRNTeZzFdn6m2IHWVlvNjaGPi0QUWTbGA34R9rBiQnYdJvqWzG0jbdxVG4imWRkFcq4wQcnkWq4x9Sgm/E5aWuRDjT8Advx+5h7ZEgEM88AsAMmU8aQvbhXvcrrvkrWkvoryyxKpH5BS5oxeRJxVwOj9vS6ufzZ5xvFJBXPBqULL65MV29yeae4zrvy4hnPiYQ4LjiK9tmGs1PE5je13OeYp8TsK3I6eqoXi5txirfdstccqRWhNG41LRBKktF3h87Z2ffWeHGsUK0n62MK7gk98WK7JSxYQMnlA1PIjyNCCilpjYlsw/J2cmOIHyoUEgKb6pqJRQlw/LKWb7r6uCuCDEl7QY0mrLxB9Rs1v8dwM1YBT0VQUR4Qdd0Usc8wLTfRcvgUIFUNcUs0xo0Tjz4WpzFYigT0XkARVTtQ1n6++z7FKLPPjRLbFXZsi4XvYoIpCoMK2hRTa4d5hPdEU3Ks1iKg81gn10ixgh1LV6Xaqt96ei2yHyoU6MUWI9sgV9/lyo+Sy+DPacNCMzDaPo0I+EzszWo2kby0XMq4ddoBqq7LX4BiuWxSEm5LUfFYFWWkZDKqNmmyDcD2K1ZdmoM0y2p/7GPY5j7kWMGJJ66UkEwb5HBV2hVMkpbYq8gvbOZ6cXdYjQjzSWmYNHjZHkih6TUuVmKMqa0FJ1Kj9K6HBZKCDaDOxstmOpJsvf+Pl8anp8QFiEkByhhVopXIRhJ2QEioXoM85OtUsx7DiTu6kKWOfs6jzK1aijWsLhKFXX7qwMyRwNwzMl0S0MH1YLDvNVj/lCDYqHZcV48a+WUPTE86jctUaZFZTgv6bvx/WnAoFzefbAfSS6XALyKJ136HklJp5ilToewgbJ7LJ6b5aAhyVGr+AVHODD5P5/GKsrINix6AdDgT3Zim4PRu0AKQmTc4F2aG29MVw9sSwBdKObLHxvul6J97bHgl70lXs4o5TBvnoHvR+Gu27M1d8ZpCIBsqTqXTXnDqteSlk1JFwhZDt4aiL2CRxYWlKKgwmsJ/nYBJXx9mZh6ZI0xlzj25OQhTRauLEzIxSsWBRUvC7vi6kn1QHETIAWGsnxw8aa2R9KFjmEokub3kcSIL5fC0L8MZoJb2Umcc1KK3d3MKTEehIWXmBaiEnAAjuuTOeXaiiUrIlHxjipxJySPm22ctmWnoqkGKtZb9TLF6qjmRJVQp1mI+sK1aA19/laovpN8G3zBMVo2nq+U0hMBkScjdBDtKYC5ahaktk5Dd6FUxxqZF4JasiayIKGYD4MK5MDZEhHig5BlQVosoga/jRyVL+il+/AijKZbkWSIWPVeIRVTltnNOg5HMhXYdaddkojfnFuiiYIuBdnFMBoOAyOUsVAIgaqmSST6OhCLXOQty/xL9cpZKXhqieLEjGNMrpFaAFB4D1j3dhPMG9kGS4Z8GXchuS7vmhngoX1LNXVQRPlE23BGvZBsJcODQyCay5BgvVQcQ28/lJphp3EiuMFOOnbB2gce3qGoxhaAMpyiHNiOMMQ8VqztDReslek9fNyHt0uFtEA1und98YSbsPs2fIhsONAZ/4RiM33e+ZKoFBBK3Dy2lwpr0JV0QgTjbjqAVo9CNONfIWtZeUmZNvj7sYm2hfc2VhXMShr9jNVl7YdXmVNgFRfxFBYSakqVcoUaf3w2EU34vNaotEPnsPoHKTaCICIs3slFWL9PImozKx2/oMqAEo9CsOC813645AdmrZKaxqVjGbEXlAtfFoGLBywufvuPRTwW5hhSYZZHsisJ2Vx/GNI68ABQpeERVBQO/4MA5e/9xUHVIAEHsW4z0xILS8hfEsM5qgzr0Uwo1yQpHRMKIlHvNCruj4KrFv2O7bs98i77RV1dS1j7GDUD5fEoqns09AJ07hMae2BV8Ym4xj3pSU5tFiS3ZZpCQTdSrfIFQ9zSLnMWowdUYB2mGSR9IoffKMEihSwh5dLa+3rIAhlqtpSAFZZ3XtWgGUtjlll3phnuPm18CRabmakvdAoWZbEEomlrqoiw6u0IvYoXfhjtQqZXcurYg44JsJSmyBGcEz7+Vz8duAtJCpyqKVGcz6sOpP1SyHPNQsDW2uPPUV+lssYFFTegill7yOXuCaslYgjFkjhUyFdZnWTUSDTvwwkpKBSlUptvDRBGO4cETJ8M5G8hTSzRUmH0Wtl2NAZCUPXhCJdPPLrMdIpPz/ovOW7xH6+OXywCtuNyWmbpLfaii/MUVHSUyIwGnRLlTJhsmLcpnKmquOABtNwwZ0enG3vO5QgxdHHveyiDLLciSLj4llAFpZqPglH9HrX/T2frJ0PZw5jRIqipFtcS/Y+Gb94oOJYotRCPenvTET0XEud3UEoGmy7bAK5txXlvEnLdIyN6dguCEsDRrdAUpb2bwaANcXBR4cvssmYP3OMp8M+G4EKxNIUoiNXhos0yJwjBUB9pGAo9zGsx0ppk+Nfz8Xi2mdTeH1E5gLm5YV3pSzgqGJswrhR47/dQWcEnNrm5LOiXRNnNcMA+ccK12kOfvPN5VEt8C5A9OvvLSsuqzD7ubiMbxVBrseTbBiIA9U85fbh0gDWe/ZRqP9W195NuFAKbAFuGgUA9zcKS4uAijxUR+HBhsz27myY/Te6zHyJKMhtoukUpadPeeFxflU4Rh8KIcdrdhBEKAIa4Tp5LMSjkwS/hobjbIDqLARcdnS5GwRB6A4gAN7/ktHCUyCKpqz8t4KqARSYDFwnjClSHoTABDqXON1Rowz7zpPJQCEeUmvm60vtn39tFLB3/B1699aCS8CPWDS3JeQE688fh0x7S3lgeOD5gtdo5MdKFCNicwnEJhEWQgjMd0U8BrozrVkoHIGb6abRAW87IYflcmvwvbShpxurXN4NPTMpWU4qLH6VlJqEWD0ZQzgGQaSkp+KZOww5VYtARQB4KEEeZ0PnvmpWf/J0EUJa0Tf80H3yOOSbJU8bQZ0kWbE7AOkbBdUhkkjd+VpP9aNQ8LoTEYCikwFdTVNLTXx1fG3713ZuTAixSqDy3DF6jMCNj6/wrrgJXMtrEYZ0Oz+YU83CsTcWdLB3BoyJvvdPNED9ml+/jJ+9JmnAQvRZelZMSD1fGotwYt05vInJGLwIiSxwdfGxIt7GzkcxMkc59b0d8XQIb2bpVbeXlVFy5kivK+ZYlfY8XjuYQNAe0FrEM3aoa58v37DJpt9mIhIYOvqEGQHmIcXmxfqi4k9feaF0nkWqi9dLbb90CPXqhJdskNqrAa/Riho/DLw9+psMBzW8SlJ5DHD0mcSlPKIST5psRIy8SV4JSpUxkakOt1zsm6AR5FE9ZBA9LoPv6AHNpp7GEVnkXn6qcY5UpZaRCGlNNFQj1FJxSE4FI+9epE4+gvR4ZhTnK1q8mKE7hAjUeM1Mkx+oUL6AcH6Neu2e42f/ls/LnQ2aUgCyFsWyi7aAmw0Eo6ojAcxaDHtAyqdQWWt4tIHUoRlCZgmgbJhXgM68pDEboIX3l5Dy6u3ZdQmflgj5DfS25/qkahsPNc1RbCq7KZ8bWl06IxWI/JBci8CGptHDia+oSk0CQQKGK3e6ENLYJhUyHl7jnplpzDbTybZMM/Yogw5k7otIY4oNRTDJjHHEO1pBlphMDUWFaih4UvpXS6mwOvVR1GHuYD586xBUkytd38QgkbMdxemLfUKt2+LearOTQHGcCcK8vxrHFuDsL4VFHzWUGNaqfFnGIKNViouDj+sFN3iTRgB8lAb/aXF9+9DTri7KlARJWRtmKlX5SJNEAgJHZro4hl7LQOaaR/sCWUAgWVZLQQYNshIMiXfyOmF78EODrEyav+JfTdb8V09tx4yAShG4/sPq3ry/HLydDKQpPRlqEMVrW4zT/L/7SdkpagBhQs9WSUXFAcjNETuoMuGPGaVZoWXDrxMjxCCoIL/tnREgXl66pI4khBlxtPyMhQoCWzxLUa0QuDhvTXS2PfJHDSmTJDosS5UcGJcwU50bI8dxOaI+ZsZeo9ONoaOLkGueXxoM//c9BpAlZryNt+E/re3wev17Za9djukhbt7YRnCTRTQUZOYpJzItpbDLjhlZXrFRZ7aCktWBFSFd4iHmb5lty8+DDdLxVPJ/L21gNQ3FBlg0uuacBcALqhPVgk/QzJtD8U4vDLkE76ekgzaBIt3jdXE3G061wWCmmjTBwcxWpvCE56lSAkRjyQsZq9js8ThEpssw+WkpE2VkNryOXLkGd/Ado3fTvo1ieAn/hM7PyV70C/9ZHQw0PQaj1CGuqL5CaPcuNEHDQKH86n4NLjNqUypBlzOA6noKOaRnVhP2wz4c6VK8CDDwBXHgR0NnMSW19vUlnDXA+yrsercSjXxm0qttCQ+DvY9eEm/PAbTylvWgdVEFWispe2LagyaqGqgbZXMxG1ZmEkJQ7cYa2cuHAtUKDacaiY08QJu3GbcrYzZhzKuIRxW4qvmSeGHJ1gPrgB9HlfhvXzvhyrz30B+iOfAN1KDNHUVoMq+b2ngtTs17MNKZmjyvAKkYqtOkg+4rc98lm0dsOrLrUXit61dwAAR1VJREFU26GeWklIOqTS6GI3ssTzmDmtJuXWwucI8VV6ayBZaSc6fzb4SJKAyXmWVtpMhZSRqaqUUV4iYqxyTkAiimcAHFJELeQYYk/f6aHlptBBm1HHeXIuvlE1HbdHOktReJWYqRpq6Wo00ljjQAR8/nrwagd6dA2YVqBLN4NvfjTk7rtHtLT/cp3PXhQuZDoGj+Em4egN1Xs6zujn6NeRtuUxMLJtQkvH3QCKCnR/H9tbH4W+WmF95hz43rtBVx4CrXYGPcgyAEayz5gniA+ilGJIqNLHgVBBqiVxBi7W8eolEnhHnyOzgh13rboAlmZ8WbYHtVrIB9bWmMSpdCvhFLEqc4l2ceAF+akXzp5vKooRK1ddRt4hGuxAAtpqPWY91x5EP3cBTA3YzKBpKkPQHIpSHEZF5h3bjcLMC6DsZAYhKxcblVu2KAht/QZ2TUkOTPPDKMI650NwwXeJRBBNxulR/jlOWnVg4LoOcVRRdjqXIVpTpER+6MvG/z7pqYiisO5aOdEaJx4JuSlwIhDMief0HjXFFbqkecXi0QJgC4ZYC0DOy+tmSuKS9Ktl4iulFWu8sHBERnsHdNvRzl2C/N4bgGc9H/z0ZwPa0X//zcDHPgY6OAudGDT7h6SRZ+hhjkPeK1mgmSGEeKy+YLHXMLWaFsQZhWa9ADp9SGW3Dh66D3rbszD9hb+Bae88eLXC/L//BOg3XoN2/QHAPabPFKYsn55LlvXG66d4jjRDRNxw0m2KPVk8VtkzR6tn+oyqPQ93vPP5PXhEUAQqlLJXx44rghyVLZMnTkkCUdx4Nffg3XPDiOtyq3bZkKgn8HjU2DSBtA1JNtOAiLbVkO0C4GmVDb1FYbn0NgaWToRwt523uFZBwQeZVhVUY48yFvHbLvNOm7MRs90f4Ae0r1idCjx5iEh1ulIkRvkMZ3x/o0rQboN1CGg2NaSmnGkQ8FtxgJZnMJUAQEaDccAmqDiJYjBSgxV7h1qvFC41L3VNaDMUTUn/8TBE18YPK6gWpNHYwZIbcwrZ151rYkKNoJ96DjolMpna6P91bw+4fB/0x34IeOGLIIfXIL/32+DNMWj3AKR97JK1OMR4gupsCPRpwBxmGQbdWWL3TCUCiUyd5utD9ocxghtclx55YuCd9ahIdg7Qrn8MdLU7vp8z+0BbAaudETIp83iAXF4bwFIeASH2FNIsGSThicacWnudOHkqHRZR7VLXtkR9GR/A21MBg1uL7YFuZXwfNmGPuHbnHYKKM4/HBJzHw87NBelWjs49AjqqGGyEj7gbzzQ7yN22O12kC7gNG68Hv1bES2gwirKRYlefRjfPfhzPvklqJ/80Odbd41mZBrjEeYJiPgYgZOMxvEbGdCWdjtNDAQmvg1c7QRvyQ76mbGkBVVrv7wPpyBwom4KYFzfLG/T5Ti8aHyJMlUWn1peHaIKwDM10OWNo/3OylRNi+8a4ZUqKJLAx9ft2aHSJ9UrIUT0MpHfQNFmF0MO1FeGhPiAytZOaJh9dwOcvAnd/EvqTrwBNK0znL0H3z0C3ltJaZJYOwGTLp5eja+B5BkQgjccgaRbo9mjswW2NJo3BOzsgXkPMIRk6e+YF746sdKR5hh4fox1ehRwfQqcV2uYQ0wP3QTdXIScH0HljLUDLaD3HRJcwDfZpfbPb9/hopObICCrpdhPSzho07SUNiVExncnzV1MYtnFwYRbI8cl4ERqDphVovQbmGdgeAZsNpBN470xizJx96Pl1BDA69OgYNMuQ1TKAaWdEpp8cQ8Tsv8zQxuC9PdBqL5Wp1HL70ArLID6HLOM9uRgLZoCdhiadJZMXy8kxyFa9pAzd2QWvpjgIHWk2NAwEzDN0ewLM2zGbWu2MQ9tFOzIOWIguQ2hFMkxGLMWashWq7I2RcdGiRI/qlmCVgadt27DW16BGCw6lJIpewXHkEbzN0RpNcduGM8nAn0ipb+FoZRAIJBBGHlgRLzybd7uP/tVXhAFv8KEF5Q2uJjUmrlBECvELTCLrSTALkEj0bPZi+5DtpluhOsfNgC5lq0BpijDoguOa53MXQNvtmJBuZ9CVB6DzjH7xRugNN4P2dsfw5vJnoA/cC+IZfGY/9eut3qx28trfM+/tAxeBdu468O6ZMeib1sD+ecj+AfruHrSvQZtjMHpJf3UmgR28W4FSB60ItN1CD69AV2vojbeALl4PnXag8zH6g/eDHrgXfPgg6MxZ05/LosryNBrxK1dMrblao5+/HtPhg5BpB40YfO3yaEPOnkc/OA/FBLr37rF/L26eSJWSUc7K/j42Dx5CmcFtws7xVcjmCHJwEbjxcZCD/TEgPnwQdPle0NHRaNdUB3JN689PiXt36q0Y9ERlrLnE+Ys9rb5I05n2Y8j1N2G7mdH6Frxega5eGYcST8YInHK337aQtgPs7qH3E2A6A752FbzdmrlnLiGcRUbs+Lq5D4szjSpZ5p7bDBXL07B0Zg9INZKRxIHqB4ENxl2NyKNakvAScPArPMbNNx2xcRrsNPcClB1opO1qkEzId5X+FWWUPEpShiYIBju1MfBT0ho6M76JxqdItbrwd4/0FWOh05jUCxTNhDC995B+xjrSksTQxk2FPkOmNdrXvxz6+CcCx0fob3kd8Lu/Nayjk13/YsPOLsC0hj50GXJwBuu/9rehN94CpQZ+8+sx/+t/Dvqil2D6upcDF643r7sCDz6A/vY3or/+F0EP3Ac6OBcna2w8lKCrFWg+wXYrmL7xr4Cf+XnQoyPQzu4on9sK7ateBnzel4DWZ6DH19B/5d8B734zeP+c1e4F26Z9zAnAwOYYcnIEfcqzwV/6tZie8izgzLlROckMffB+9A++C/LW3wR94J1oAtB6lZqBnizHEJAwQ68dArc9F+tv+Tvohw+gTQ3tDf8B8tqfB17+XaCnfT6mM+cAOcH8j78X7a5P2tedc90IAvoWfTuD/tJ3gy/dhM6E9cc/CvmJHwSe/QK0r345cOtjwev1OJxOTiB3vBfzr78a7aN/AL54IQ9A32REaMwQ/UiXaMXgeDbpI5zVf7/elokCqxXkwWvgl30DzjznReiH18B7DfN/+DeQ1/0KposXbBVrvTQBsunAS14OeuIz0biBt1ew/fEfBP3hR8Fnzw0a0zwXsRWgxk1AyMyzSw9/gZTPXy2pQ3LmpEUxGBwCZ00Uk9iwcXdjIDrPoSgKfZOCHHpTA6YY5jQavzxQwhxlDJki4tr7JnLxDeX6hhA0nxiOaClHLDElKoE2TnDRMoTrMg4VL3O6Y561OMGQzqlWULdu3W0NenKCfvYA9MTPBt/6yPGtHD6E+Xd/G9w7sFql2ST25jKCPGeFnDmPdstjRyXx+Ceg/dX/O/gFLwXOX4QejpWdnByCL12H6Ru+GfRZT8P8v/1TTPfdDTp7flQfdmiq2A1gQic5dxHtws2gC+Uc7DPo/E1o528Kd9bRzW/C/JY3YL2PxY1NmnJhOhktSf9zfxmrb/i2EZjZ58Ggg0B5H7R/EdOtTwQ9/8vQf/1n0H/51eA+jzXoPDIc0QvTZO4WRGGDqr09TOcujs/rwkXQV34T8EVfn/31rEBbLTNA6v9CALaH6GcvYf3UZ9nvbAa+4htA3/jtoINzQ6btCTl7B2if+0K0xz0V23/5P4M+cQfoYB+63cRGIwQ2aqq/ebbcPsMBYTXWzMFUkEJlcmn3hP6et6I9/yvA568DnznA9Nwvhb71d21mNdnqkEAyQ/fOon3ul4LOjs9i85bXQj/9KfDObs6kOIEo3Gxz1F0N2+L9UfdPdIdNFXeisRWJAdnKCLRlG3nPmjMwyZg7sm1deBc0kf1xMdc716lH+9dtJt3dNe2xFJ2AhwqMMp5IMoSSSoK4LiVToTPW4rn3IQlVCuxIU3UxiM4SqbVkC29yo1pEHgeAa1QXTdPXHUZuzsGSQTrjnLh2DTwLaN3GrTxr1W34shu87cDRQwBtoFcug259JPgJTwdWDfKRd0KPT4ALF8DnLgDzEfp9d6N91vOBv3gF8r/9MHgzg/b2gO1sIBIjEK12oPMh5MF7gO0RZHMC3j8/ho8s4++8dhWdCTQfgx68d7ycrgRTtbLWYKvzBvPxMeir/jJWL/9u6LWrwNFV0LX7IB94B/jqFej+WeCJz4De+hgQ7aJ97bcDOyvoz/04WBswrcbNyfaZ+oZAOkg6+ORkDCHn7QhAfdrnA3uX7HazW24FiHT0DrBwJCpXezCpgo4eQj85hG6vgS5dQvualwPrFfoHf39cMBdvQLvpEdDNCfTK/eCLN2N66V/H9pX/E1abY9B6Dd1sM0rO5x+z0abmLajP4xaGzUF6DxpzbABklOPt3HnoO98MfOSdoCc8G3p0CLrp0dDHPwX64fcCZw6CfqwnJ6AnPMMO93nc9u/6XfDVh4CLN4w200NBVCxVWePZz9yDQucJfJ3m8I+W8wtizthHqaQgmydwchuVseAXeoVE0srcBKGSbW0FuXTj2yfs7kCPDgcttBpePJfB/OPSJRl/NQjCpMGNCd1/4CI0CVFKURyGpTZTOcG8HpoBK5PETSou3HAXlRuEQhXHIVyKDGZDQbO5FcPpGLeS5NzDUc+upV6NYZfwagwLD66DPHQZJ7/xb4A3vwm0OYbs7WD95V+N6Uv/PGhzAj18CO22z4d+1ushv/8W8ME5uxkTuqHMaLt7wFv/Iza//wbQY5+K9pK/DNk5O7wVb3ot+ut+CXz2HPq8Bd93L3hvD3oy22doRCE1F9JDV6BPfzboq1+OfngV0C34k3dgftUrQH/wAQjbQ/G4J4K/8dugt30BZCNoL3op5ve/E/Ked4AOzkbvHC5mMbiozIaTKoj2Gx8NohXmj7wH8oG3mENuBbp6bYSi9hSIpVVZzCy2BrcG6SvwjY+GPnAvNj/9o+D3vxOgDtk7C3zeF6F96dcBO/vAZgt61FPAz3gO9A2/Dt69HkpzeCGIih/E2Qvdyn6axr/ngpeaqeCW9vUKdHQN/Xdei/bk5wN9Bl28CXj650E//L4xyG7JR+DnfomV6BPkk3eCPv4RtJ2dUGZ6N+vR5oMh4OLUhM+kZTvzNp1K5KnPMZ6ZOLIEXTIeEXOcqH6NFHEda1E7HEQLVaja0s2k0a89+BMTTdMA5Xg8tk/9zf5K7Jlpk+2gezoGXUhRLZxIdS4ggeZKRDCSLygWSxGy4CWocoyxKTUGbrJtNgicKGkrQAIwPFa55mlSh/IpTYGIlf5FhmmtxkgwHomFx7/w0+j/7mewu3sA3d8FLt+P7Yc/BLQ1phd/PfT4BLp7Dnjk40HveNv4+VeT4c1tnw0aoaF3fRL8iTvBytDNBtgFSDr0nk+AP/gu0KUbQfMo40NM4m4uFSgT+OgQM6+hX/CV2Fy8CDx4H3aOj7H9yX8Mfvc7wI9+zIgsYwCf/Aj0J/8X0F//H4AnPwfazwDP/3LIB96LSc0p1wUgM3mJ+fi7QOetCVw20DYB0rF9069g/tf/AtOV+6GTQmkPbf+syYGLkk2KF14rWn0CHR5i8/M/AbzmFzDdcBNk3dCu3g/9hTvQoZhe8i2jFWkNfOvjRk6CDz9lDq8CFQ4j2TxgbI7s9ykmaWaEZoNNsw9R8PkLmN//HrRPfxR66+PH8/DUz4a+6SbQlSug9T5wcgy5eBOmxz8DuplBOyvgDz8AfPpuYG/X2ovyPDGP56keOkJpwAl7tWQFDPfKSNLIKn2Xs34na0tcwS3h/jwlq5WsIFQq45ChmBXrXbr3G/8fP8W0uxMAyNAEuCtKFN16GJ3Fsj2ohCNySNula4R1qB077Io+J6VGtHUmsxE5H08sRCHluT7EiH2z79bBiRrXZf68cwQXJ17AiJJrCM9QF4ScNuNzxu4UO2cxf/KTwO+9ETu7Z8GPuhV0sI/pSU8FC0N+6zeB42NgtTu+pzMH9qLweNBR2H12qPDBWfCjHwO9dD1AU7Ik9/bBN9wKXLwOdO48wOvoa33t6rnvenQMXH8r6HFPBTbHwN4e5CPvA3/6U2iPfDR0d2doGtoauOWxoO0x8L63AX0LYgY/8ZnAdTcAfQvlVaYPS2yRx+Fr/DnRDqx3IH/wXshP/wusLl9Gu3AL2v7NmPbPJu+0mgqRke6EHuo4Wu1A77sH9O63Y33xeuh110P394GbbgWdvwj9T28e1YdXs7u7YzjYUWzN5lsxqbM/U9GKBlYtCVVjyj5MVsoNumJgdxd8cgR546+NOYYI+JbHAU/4bJvjTJDjQ9BtzwVWe2Nbdfgg9F1vAp9shvCoxqcZblLsOfao8Pg8FJbzN36PbBJtChhtjXDXtC0bX2EQs2zeUZiHMAgLGR06JHKtgET8e2EGth04exEXfuR7L0w4dw745D1gbZDixtKe3vxgnHuoYaMAELiK0OPENSCICV6EuIOOUtXUbZNgK0cDlGcyb8GUOfqKDMrgcmHXRA9vdCt8f7s16wEgPLLYaTsEHYYTHwfTPFTEto0Qy4Ln1Qpy+QFgFtDOCnJ0NAJBeQLv7Q/X3ckxaOdcknoDoW6acD/I3Ne/7dDDa5DjYzRn9+lwSuLoCLTeBW1PgpAzBl3ZB5LJken8JdC567CaZ0Bm8OOfBvqe//c4fKdptEG2LpJ5A7543ejlVww+cx7t0nXQ++8HrYdrTtEBbUOmLAhFo6IbA1+AD74H/KlPg299BOTk6vhz3IoIpXACm0eAGbOgmTuPbZ8ORl+tQduTUXkcnYy9ugC6uQZan/W3yR61AYmh7sEhYyNE5IaWU1ZZri+Vm46cIWjVoRJwdh/y7rdj9ZWfgZy9COId0FM+B3j/20DHR5DVGtMzv2iAplYr4A/fC7z/nWMV3DNByxWrYyBN+VyX9tfl46PkL/mu7tVnzXSn2NJm/l/YurGkcSW0Jj0Gjs0b73y6XbEezzvWK5xpZ+ZpuvVm9Pd8CJC2SFBJN+B42Ye6jKEsaRjyyTQX0GJltbs32pNatJYiqcQaUdwEaitkdrLz6yhoMI7LyrqS078f6yzKfrDGT4qMlRs1C/YcksvRR2K5UdCiioshmFUr/tBjzAp0qi8A561EVlpws19ASqqpRHWFw65YN126ml8LC/YCEYOmNWi9MmEJgW96PHDT44E/IsLzFBAb2NkDVjuFxGMmKxbjBlaysRoifYYeHY6DabMZ7P6WjsSKUhj7aQ81mUzrMJmoC2nTJeMTqgFYRQZdym2IwJKKHBWclcOqp4JSKXMGIoyV0oCFU/4NBni9B1y7DH3nG0Ff8rXDR/LkZ0Ie9QTI7/8O8JwvAa5/5FC59g3m974F7aHLoPPnM6DD+3XJANvIffA04K6R2Iti6gmQiwuCbJ/vz/64AH3mxclZCLR4lVYLMI+Dwu3JGYvHmSakx8D1N+LqjY+kaXP+0o+uQd+xTT5WyHjV8t7GxD5Jot57cJn0Ow12KOXs9bVWYfx3bq2VnGR6TxOkVS/bq1aAIiZs8M+oOAdlSZChXEv64MRFsvApsYmEeNahQOu6iBpXC710IIUjn3jVQpBCK8MxEy+/V+tBIWpDVbvBe9puubV0BnpXIwrabICTDeiMvQAGSCHUnAMEhkrnPnTgO+txcN71EcgD94+S2WPV/L3px+PWVQGtVuMGuHbNbokUZrkgKFKeCmBFRaB9mwPBoM2UXTYnO19NuK/NXI08DYGUC6VaA7eeTst6U9c+wqXDkn2/2jPmIFeyfMjFKedfQ4YPYnyPmQrKrVkqk10y73kL+Ev+PLDZgM5eAj32adi+6bfAtz0Psl6PDcx9n4a+/XdHm+df2+dh3SZ+s0M5WoawOGDCJM6+EQi0OVBQ+RrDcacv+WA8yUuF/NhaCXUZbng1Pwj7mj4G5N5ZEHDjYx88eNFL+nT0ip/9vvVjzn8HzceKRhR56GaUcdeeu8PYTqBBpOmGSHI0tiSe26S+bPOBRYhAjBo8I7ClbZGLrVKSw6+nrzLfgHYXKlEMyjBbFBSNaO4xRJtBNlhCs8GXv1ViUViU9J84AKx0JepAm9L/PY34MYcrxgOhdmLLKFe1cagoh+vNS/oSNQ6xtFurGqSnJwMeX1VijpmB4yPg6Bqwfx5ojP7uN2P+yX8CPncBNO0CurEKC2MGcHw8WqRGwP4FEK+A1dpu0pJSw3kQKi0AstZDlrAWSi4KSiJOwFqmIaelqUGnlr865sB5kXMDNJ2cWtu3svOnwmyIVB5ftJjRKEpntZWcv2CeY2HYeTjvEQqsd4FPfhS4833Ao546ZLWPfhLwiMeBbrzVchUJ+t63gD/xUdDBgTEGarqT2kVo37kk8HYMg7lkblqLYmnBrLmvz/DZEuzqL68PDzmRbsQEnRxO2yI/M0Rdga03jYxst+3SDSu85t8+l77ub36G24uftcKlcxvMsiy7xNd1uiCfVLMDJLnj7nlnbvG7VMkSJ8g4PvkUn+Cf5s7bkMetwzTKUtdBpw26rBqj9zAxkSvAfE/cx+0/xCFm7pHKPlgm7aKVA4DbEM1M62EvnSZom8DWBgRYIrBmffgWPBnZB45mZRW3xfaOMFBrBzYnwPZoDMy2vQz+EAOc8GOs16D7PgX91MdHv99ntNueh+lRT8a0UfDuLnh9Brx7ANo5APbOQ5/42cDjngFdXQDNNEp4UHwWwXPoBd0VSDRNlJQdjko11ATLAS+V1oJH2xS++WhhJk+HLWk1LuktF8U8jxdZRtyYGlUqQl99G1DA7xH3BpRwE2s5GoUvgMh+/raGXrsGecebTEUowKMfh/aCrwafOT8euJND9N//vUEsZj6FmS/5DtOUIR2+kmsOruSYe2EehxNbJQyhYCO4vonMv6+Svg2xjVD8XmqgCJUgV5+HVSR/40Eb2tnZ4nGPXQ+1/Qufw/ic29Z6dJJJpAYX8NJBpBgI/KTDcM1lbk8isYhTy+whCsyE5f8rMU/u1tKlHXWUMpySYkIBJhR4RO9Jxu3jJRSUNZCM6Sms5Fcp8wJvMXrqrUPUAVMXTjywU9M0cNRtMOCVK/scdnP36GWZUnIw7NHZz+p2M8rK+WTczDfcAtlcg97zSczH16DbbXAPPJp72D4BnDkDunYZeO/bh+JMOvCIx4P/m2+GXjgLeuhe0OGDoCv3gu7/FPCoJ4K+6TvB3/r/BP2174E85bPQT2bLjrbZjKPM7BYWSCZCORHJCcrk3gEtCCpjQZqVu2B0EoldKnRywZafu13yM+o9O6u+SWBGl4JV6/BUC9HUivgAg05VjOow00JDHhkUNgycGPqh9wwXKTN0tY/pC78ceu48GjNwz53of/hBYGfXvD8UBregFhENSTq1cdA0Y/1JIsQjOYicBj1uda8SIqaNOZFxlrU41ouyYBgoSazuo13DMhog/WkT9MoVxVOfucJzXzIBwPTg2bMP7V89/l94b/d7VLXrWFSE1dYxRAsUlaYVmKhMe6Fjms0UVlP/s1Qm/I6IIh94lCEuURsnfoE/JtDAS8yev8CuYSF12KKI+ZN6h/SORmMGgN6hqzQ/aZFhDttns9Od0bZ2YrLnsMFewMn6Wc5bSx3JvIVqH8ygblbeRgt8lrIJRB68f6wQzxxAtsdoX/jlkJOrmK88iH7pZuD3fgv0sQ+jnb9utAelzcGqgXbOQN722+if/yK0Jz8TenwE+twvBXYPgDe+Drh873hJbnoU+MXfAH3UEwcA4lFPwvHbfhXNVnzJCbTWxS3ajjfX9MST/wr8sKWaZGuVgd30bK6zELiU2U+AVnxj4GIXUYBmoJ/Efl3nkzGzsHI5497NTeoto20Ygqyjsx1mGg5Hr1Y40p2GhJZkBnZ3gU9/Avr+dwDPf/FwjbZ1zBv6u96Edu3akC4H96pstUJwNAAdygbB9epAPVbckWmlZTFOoNQWWRM8OzYNEtUSOeK7j54/MO8YVnAxEA0bJ1Nni57vfabd3UkeOHol3/aMTyhu5+kRz3nO4aduu+0f3fQFL/6e+f77RVdTyzLd0MumV0c1FhSttxt93ViSZhDL4jOF3xD/DNOO6PgMHB1OHsrR1UpwHTpoKKS7CkpTSCFa0l0ddSzDnSYau2INN9h2DEaUikvUbrM+vld2Xn1bBaoazXLhWgqM/GAgLnJiKEhmcI/Ra8aE+UTXy77dXWw/8Qn0j7wf7eY/N9qUs9ehfcPfAJTBmNHvvAP0B++DrtageTs0FQKjMxFw/jzoygOQf/sK8P/te0G3Pm4Yt277AtATPgd6fG18//tnR4+rAE4ewsnP/Aj4LW9GOzgPzNtliIS/g1CwCIQbRBt0Jsg0DWWc99Dd+JHk3hHHd+WGYzwrdiuZbTYMZxYGCvQxOGUyFV8D0MaL13g8d32O1Bz1F4k4EO/EDJkadFqNP09Tmnkc7KpVWj5K7mHA45HAvLsL3V4Zff6znj8qrpMjYLUDPbyM/u63YrXeHV/XWwoLj100H6Ixv1IumcNc8ghUIidhpPpOZpTTyAHkNg43qIznvw2uA5tOh80CL1ZRaMCJRuCMeiZCdaOeHM586dLu9o2ve2X79h+4T1/10mHNu/j3/t4j8OQnkBweg9sqHnSeMmWVp6nw80pQZoRF+KCjjVID7uyr/PvRE7LdZmO4xlYt2GDGBxyGy/ZNhKoDSrPbCwgicj3mJ1efGLqzGj9Pm6DrXYcUj3IxJqMePW289dU0JLK7Z8YHt15ZjDUiWJQwWG66WoPaTqygxAg2VG5MMh7bMNkIaDsDNKHJFvPP/yvIe94E3j0zWgohtDah9RmsMoRCPNBXDvtAG/4CmRV87gLaxz4E+eHvA976m+DtVeDkENjbAS7eALp4w9itzyfQT7wfm1f8A/Drfh2rvbOmk08H3YLfiIHipp0d8NQGfWdaQ3f3B7iJnXfg/nTOVXBMvTmSmrVN4P2DjDQP4pBmxp6belYNfHDeUGcNsrOPWaQMRctB7I5LImB3b5i8prUNencLQddXgIBsZvSTbYjBPF5L5+1Y63743ZA73gNdrYYQdb2L/v53gu++C7SzLhATjoSq8QxzxHcppRs0UqWVF/yLGDbz0LfkMkkzhdus09zacP7VRCvPIvRAFI+Z8+baB9I+sG2MfnSVcNMjQV/7zTerKgEvxaQvfWnDTTe9a/Mff+9l0/nz/7Z32VDDGsadUy1fiEe/KaIZ+6TpUY+8tzId9TgujdirHMB5iAFKOhUoE3WUEjOllrzj7USQeLlZ+Wjx39JBO3vgKw+iv/5XsjO48w5QW4/nbdbI3uNgsc3gncHjk9f9Ivr+WfBqBXrg3vEwr9hy6wl6fAJe70Huux8nP/9j0LZGW0/AB98L3dkPiCqcEyFmm7YVlPaOtrMPuvtTmP/J90Gf98WgJ95mZX5Hv/IQ9NN3o509gG5nO7A0SuqQlcoM2j8L+synIf/0B0BPfAromc+GXv8I4ODsgIJcvhf9/W+DvuNtaEcz2vmLkO0c2QbhDXeIK9m+emcX/Z67of/hJzAfH2PeWYPv+CBo/9wwxFBZaXpUVx8tILuNdZRQYF6jv+GXIJduAc0b8NUHTXCpoO02V8LKaIdHmH/xJ9G346Xguz4GmnZHJVB4ETQ5JxKgM/vg+z6N+TU/BWz6GNp+6N1oe2esXZgyis4pxGJisRmgFUAnWwAN8pl7oJ/4KNrTnoOZGSvM0N9/A2jboTscyUtBLZ617OtN8q2JXIuoMBSQTmtDLRi7LJeJOJnKcHoOW3VtjEvZvco28xbXFCCi5F5IMip1nnujturY+53tN3zbu1ZEqrffrqQvfWmjV7+6H/3AD3zZ7oZeO7/nA8d09szumN5TuSWcE9jHzY5SisscHDRYma8Ro218vxVFgk34lO2bY86cNi0ijsCQAbbe0MAcDYtsMSV5iyAW+7U5wnzfA5i6QptCd1do588OXryM9V6QceylYrMUz4eHoHkef+eqoZ09l845q3gaEWS7wfbygyCZx6m9s0Lb3x+DS8ipSGyK6K4xZO2g3Z2xsbjygNmgzU4KBu8fgHfXxtf3clGC6js+XEqakuigDJ8cj2HlzjQOj+128PLOnRvMg812wahUNUaDJMTDV256coL5ypXxM6wItHcGbe/AHOSMZn+vBmrKFGhelDUO3Ha/ehVytEFb86AgHeyPm9v079rHSlk3G8z33zcOmRUDe3toe/tx4wfOipE3KDFkcwy5ehU8CwQzaG8XtN4zWTjHgE19hx5RubaN2lkDmyPMqzXwzd8Lffrnjpj1e/4A+Mf/L/DJCbCzNtevDaK7IdK6ZkXZ3RVElpblFCctA1A2vqbavp7zQVEYGahG3SPs5FoSlhO/bs+FcrIEC+PVWBcn7YmP39nu3/rt67/5D1+p3/ZtK3rlK7cTXvUqVSLafuWLH5Lfe8eHZDs/mkSViKikZ6c4RJL0Ks7+E00wmOSHmgGXQ6jDZBRTGZBJbjT6HtPKJzbMsvSkl+qCAuI5WH1LuIL3+sMTokDbwXTzIyJzjUmS5+4voVN07UQVmy+08xdNlTimrNq3wMmctkqRISJiwvqGG+I3J9sZMp/k/t5jvmt81NY2I9OwZVJj0HU3LyXQTlPezNYmUVREEVAUK24a/54qcHAAOnsW2NisZN3AB+4fn4eCL+TdSDikwVTIYZUY+Qy0s4fVwXlLF2Jj4PUQsnhvGhFm3su6HsDyCDALpoNzwIXJZkXdlJoSROBKDZ5uuDl1H3OPm9TjwMdLUEJbSUDrXUw3nYOKoEGgJyfQ7ZzcSBertdRjjFmCDQoFwJX70Z77JaDPegb6yRF4/zzmt/022uXLoP0D+8w0hoAZA0YB5fC1coirtLpfx4BbzTih5h+Q+L0XrGe4ZSXMPH4pawjmJBKfMtmLIhzGsztG6LEozly8k575xZ9UgHDLLToU+ESit9++Xj/3C97y4N/6uz9w7rOf/lObD37omA7O7FZ3lws2aq9IEXLBERsWgpBFRvn4HsYmhIrYJ5NcteTluWWTLEosyp4CmoiIrYV5qZiCFEO5ZsPLmPI3ZHAnMBDSJRJNMVR5gm16772X8zhmH9Z2hczHGSfU7DaSlPiOTMDkIYB0CYHoApKN4eO0BE2Mn41d2uovRM9cN7U48pivb7bGS9CIW8fGv6b1rZK6cWolJ85pCyGHsH31ycn4u5tlBXCLWygCRdk0eSH1pkze8XXVdjugHkqZrAQth2NaZLE5yZeem/XSBlaR4fuIkt4RvYLhyjQRVYBniErMWmoViO0QgI4siatXBkvysU8Frc9g6lehV+8FvectIfai8NlrRqlTyY0gsUgwjrY1yn/OVmvc/D30LF41e/iII/ngEW3NXYGUysBZ4nthZ2hQHmhRJUxr6PHhpj3xybvbY/zY+gu/6pf1h75rh777+08yHvzv//1ZgWn79Kd/SN70rv/Ypp0v6qDOjZtPiZ0YnDlpEjtw8myz5rLcMYX0nh1KmZfrNBt7MHweEt09lRim+MwGH6DuX4OQ6+kzvg+w8ipu37ZKwU3jkvo9DhdBmoCKisXQAm0QbcnTayRPZhfpRIhIqunYpbMiEXM+pNMFo23UW27NnF3+cOS+PfMfihdDDXHl4arqEFdJMc+UN5Iiw0m8MnULacRaTyaIoYyQ8qDO4Un3aHMOK3fyHGpegzsfsYBVxNsnJTbe18aeOOUejqBBIXr+kPT7Sk8MWlLpwch2RmfXhtnXp/Ezyix1ZGztHwGHV6FP+Rzw818MPPIJ0MND8O4+5re+DvTJT4DWK9OVqE3jNdSLbljzUj04AESLbMHxjPbhSozfsUfUoaRZ+4xzfF0Jdb6O4ToBrINS7XSuuEhKsnD5+4W4Ma4cv3X1+V/xRn3Ft61w8Ytn4EcQKB0iEtx/f1u/7GVv2e7vvK494XFrnJzM/kuPuG+fvho52Kf2GsIco984lNBuYoLZhbWcxC73DNZ9/qBUQxRAqPZq1YIh1zQdjRPVjhF2rbFNYh3SUNnsMAusilWhKXxy9v54gcVWM3JKyzBuhCibi3af4P0wLaSxosYa8D6u0pf9wLMdsCunVVMRqFYq+2GokTZTwiJdQKUpUxanOQ95T1mjZgSbZzZIXEomQTYBS/28w4KqeRjXWzzSkCteXhLmEipHlIQddUUiouVw2IUyLXPtdfD3BjMAGYPubtZmA+ziXXGALVl1NWYXIy9wFgK+5pvRnv9VoFseNyzL2GB+6xtGNWIZA1VdpyUdyD8T9eomtAh+KIhlCtq8zBBxi0rKq0NLJYqqxd8hh4e6oi8Q9cMsN5BneTmoB9Nujme+/sYVbn78e+ir/tJv4K5bGr3sZTGtn6JW/+Ef3uilS7vHT3jKv93+zu9+/rR35qu69pmZpxgIqkBmZKBiN/eYGUGiz/LAjEiX6TF0CqS3p+fAelvxyOe8ofyHiqlnRJ9RtCBiDx8ZNELsZmIL7g1DjGZSSkRCdyTgM3ho9jNoTsXD4OJDSJ95eP9bQj4l5hbkmiUIlXLYoZunE3JM4xDJM+7yciunO/NE08QjSV8JRFQEpZRsQltjDj08Z/nf0vatAdcY2G6ahqBFuCQ4a2oeOAIuJHXpDrpUXQSLjNVXhCdGiVxNYQtxjwlqtKQrZ1oxUjTUMhGJvKdGelNEAJ6aVTQU26hqpwUJcOkCeM2Qez5u0hXGye/8IugD7wCbhiKz9iy7Mfh9yPj0MSOP9iSShl2m23tSeSlTqasUXl3wtUiULa2ybweQg8MqRtXqEVYIrVerfuXaW9rnPu0f6e1/dRfApjpqprK2U739dux9y8s+fPwjP/qx1R9+muWTd826Xo0Htuc0WjUDHtiUcxApWn4L/9CSH2CKKik/TEjGNG2OY3o+eiQYNlk0n75wfbqSz0vTLkN9VTcDnpNmmgGCGCNyDC+ZM+raEVPjXacAS6ClGjJwV1xSj9FCmZVx0wihEjdvLTjQT+rSaCP8qCyCum0QZy9L8VCoqcF8yOM5dpEb70YTykzARLJnAAzzso0b/7MZZz7DXiLa3HwZPsbIJHGJA8Zv9nx4KfgPYTP3AaHmS+MUHOfaq5YwmUbRGqqnBblwqU1Jj0L6OSI8s5kRbZ7BRGAMNBnxSI9y0Rm1FXizwfxP//5oYaex5m3XrqG1lZm5LJTGh67GUYz/3lR8FAG6uqjIYGtcWjXIdlCMqVEZKObcS7sCU/HLMBe/gQZlKX7VXDxTZk5Vw9GRbJX397k/84X30le9/L36Y7fv0l/7fjltF1/8o7ffvotv/VZsfugVvzg9dPxlsj0RTDpmAV1CFei23zZNYyJegg7Gg+qB3skbJzMFRVCGq8Wi3JNS1kpOcH0PWk5aMYUduz5di0FCFiSAjPlm+xAdutjspSLOCawlFcXD5EgyKntcN2mE6k3sWTC6sJ/qppJLa647AIu7KwAikatiNBde3KYPF9Nj0e955BS0svldtJMBtNQ8ll1ycBtCJ5uNmBqzrqY85Qn197b4fnJu4/HePvuJHMdqMV70qlLWkGlkCdtscfXRIgvCvSAamgCNfEseMJNZIolKjXJElvI0tj5D1EXd1KoY4SR+wDil2l2yAb3JktYsvsXFqjUlyd+BnoNgJFjXf7TYApVdP9WBHmly/6ttuEKYaw4is7S+Qb/1sR9p3/Q/PAP/6vuUvv8njk+/7/wwgsQLXzjT4x53jJd/zU/S/h5NgtZnqP9Q0pPjP/LaEYm/YQyKUMlU3Cl4lGQm0fS+cUjJi0HHf/nOV/K0WtcLuHYaHB+2uLNLDGUVN2KNOHPVmf9Ze3BcgdQtvFTGBy324EQpXlYaYjc3oRw8Bekk3m9qOrliRdrLCq5bi2M3/PircjswpsccD0K0LkiXZnzWs4SrbvSbxV4vyGCJqn7r9nIEu95jyP+IMFDUtGc1fBtiqh+WiJoJACyGuVlZYUGTjoQmysorYugcJEOFjguYytT1Bx7bXaLue49VXxxq2kErT6guhiAiYLUzcg1WIxXYsVpFYzvEO1oqUHH3pAaZqm7IxtDRiBQx7WYTP46Iei6HI1Uegq9FSdNJ65CPEpoTI/AYLpvp6eSQcP31rF/wtW+mRz/6CC/81hl/xD8POwDoRS+a9du+bbXzeV/0r/st1/+IbPtmEtUKdxwldYv1lCvyEH5rzhew5qub3NfTyCKT3Q+BiJZuC7STCpI1GNmWOZAE0XggQp7KMfFWAzYsJMaMFG6YjNLTbIitPGcOk4tGzzheRme+hxlKtJwRg0jsQqnIo7e1UAUmqANNCHWZlxpxKV5Lu+Gp8PvUAlgdBTVe0B7sMHIFoRS8WBWkMJW2pqV3PrLvbKjJtGjBYhYSIzsUk5i/jD38AMvVbWUuWKvnAqlw8tnAiwtSO9kZ43c2lTnJwvrmvwdB7VtCQISxZfDnbgS2tvQHSJkxEIqCMKPomdvQsISpCYWTXRyJgfTWUA769zI6oQJcKPZFT72qQAYfPnL4LcqQmfJdMWOc0nwo841P+DerL/7av6KvemmjF73ojzwACH/MP/qKV6zo2799u/l7/+CO1Qf/4FHbnfWkXSLsPYJAy0MA6uDGdouk1z+AWeSOJ385ONqHQB+bll/DLqkZbqmylANrPox6Ko8uTzefECOdZF5im204Wglmm6gigyyxfBDY6UQ284gpvos7kqeVjjbNqj2e4Sin0+IaKS/wMFCxdWrLNOTQkUtoMMi3HwoIxExNVAxbxZFIqYOoAqNQIdqLw9zKajJHCCOxtxfuXPIeaWoDh57yjNChZ5/KMTvwxOBYpVGuD6km2yrlXMv/PkrfOxatjhOdZSDIurdsfYypWhmyOafF8XFdhnrPUeA2s+F1gxh1J9j+w2oIdtsuLTcxFG2YC6NMHeqR9OxVFRWhnUuMM70nEqu1COS8b/C/t5kxCgpa74A/c/dGPvdLpvYd/6jp626f6EXfP/9x7/kffwAAhFe8Ypqf+6wvm/79a1+zfd8HttjbW4mnrVA+FHANOeeNNR7yBHRSTGYl8HhURsshBvJBh3/dBSh0+YGolhhlkhyEwNePeSL7DagkRcRkQz8mE1No+X44V5TIgMax+oK1Hll6xUvrv0SbB4Qd1G5Sip6e0g8RO3pNLiBSmptecp+L2Cq0maLRCU4RIOq5i75qdUEKJz46Vq6nQZo+RS+swkBfeRJ2zixydWpVmaYM2PrDha07kI7d06Y4U4+MfhQVGeUmAxE/bp+pHVpcdQKlehHUQ6IkDCOts3mzSupJ/LlxvYI7IGn4HOJgsg2DV1GCHGQ6GZj8cPNDasqkICWfPVV0SSkGrM3z8NNcg3pYiGTAq9GFeLULeeAz2/bs5676s17yHe3OB/8lvexlG/wf/EP4E/xz+IP/7K/u3fHRHz/51D3C08SBMiYfvngQQbfnJDkAzIm1Jk9LDeIsRSIRBdDB+nqxWKSYDKP0j/ngJsAUOaBxz7n9nWGikr6Ijo60Fs5Syz98Knhm9ailhlztjNoisdOteMTts4kbtgZB+P62S0avV84hcTyAdZAU4pvYcPjUXyxNmU0UYpoKG8TF0Fa9heFyC1trUPIc/SAgezklpt9iMFQsSEWI213zIReNgaKv7cgOWFU/zDUCWwS5Jk3QC6XQx1axqqlhJouo14LgGuQdO5kcDW//nhOJyF+caB2KfRtaVmiSL6KRo2uwB9fncjzkEA3cq7kZOey7sS50QGmXZF06FHVxISZHMg9tCQ4gDLoaPoPVGnLl8rY99okrPOnZf4e+/jt+0Ges/0fvNv/nXn59xStWZ/723/wJEF62s7vLmPs2wJFe3pbprwKhvmL/BZa3S6NMTiVbTZQdFKAEYDra2HlpdWKqi8GRtb7WFogN+wIdLgVTpYZmgsErw7DMYbzS2PJotB4Q81+Hbt0Gir52E85HJDIT2W7eAsZw20JZm4VQxYWQwb2n3BaIDp2HbW8JLvR29CmFPNhLn/F124j4JjrVRlDu5YWMeYAEWwT7IctbjSCIVKCpI8+YohT1Nkl7pvNqDMykkJ+02Mx9TlYGhxNXYmgJgSmwUkdx2+8zpvCthSrV+/pcWKT6cgx1665f07asZKAUijlJBG3G0NpR6rbNsIRh9gFz8wMlUWrkLVaZReV7ks+XOudCJXIFx8qbA3WG9Rp6fLhtt9yywvlbvpO+/jt+UN/2itV/7uX/E1UAqkp49asZL30pyw/+8K/y777jSzeEmdZtilMoyq8k9ZKjjNS85VR27UFPliUkVOotLHnikgRjjUqPPSzzlCuvIo/1sjknsFggyqLaMEmpVwFi5W6sfyOW6fSFIRZ42pIBV2cRoeQyrqGmmGVsUiTWUehaZgeI/nChj2ddyIQjaMJZ8DV+jcsBGsiSQvJ1DJhzGfyv4hqlYsaZ0Au4mEVyRVeCYCnJMCl3NhVbrAFLK5RlPRcKMUqUVQ5CCzZ6MVHPVZwp/BytZcM98pkT+ZZFwj4LcaVjDYlF+hPsOeWJK1A9qqPAgNlKOjZBJcUqYr4sJAexHs61s19g3hbn0EhST8PIpK7mh45duK0pybbzwe60XV/4zvV//2M/+p6XvnT99Fe9evsnOQD+sxUAUeiMen/es/8eXvgFV3GyabqZO3gVA64hcR7gEFgOuYIjMsyZD8HBFS18tySphNxSy9QUHC9/pMAIUipaMoBUOHLQx79bKIQeKuKfcc82ol5MiwFjlZJqxl5BSmhK9xWfK+Mo04B8PlBWgkz5vaObMlCcjeAT/tAK2hQ8NxzuBtS4LZAafJfhSqKlAiopzmDEEr3thxWwyKyLpYFPsLUKbnjBCdSiVwgY5am/1xWD8Z+pJtcWJaMhyXKXWeLfXEHqz4nv5h0Qa0IhtdhwPyMkosRQVrwIK2/Im4HgOVDztXdxSZ3W90uZM1Sdg1Vk4yOS+P5iZalF9Zhrskw+cgGV+Ub8sFdT2NpQWBpk5j2i3uW/W//3P/aj+m3ftnr6q/9kL/+feAYAAK+7/fbpRd///fP2V37lhdP7P/qz29f/3iVdU+eD3Unn4UnPrYZp1s2ZFYKIOGElDSmEhcCGSw9JpEv6qvPXUQ0WKK6sjDpXO3E83zAeEmQpFgGTGCur1qZyu/sKUxeRa7H7D3R5z8ATSFGyaYg5AgyBDHIMcwtKppur/MpnBmYbbud+vk67vQ9PMm7mATCXw5aqsYaiClDQkMtWPgBbvJP/XZIVUAxlBQXztuydw1Wpua92f0i8xFQGt9bzo0hgqawtq/Bm+ZIV620g4k3MZLen2pCVvdKIuC2OiZurDCPM9OFLRZuvpNLSn52oNDXVl7l+TE+wW81DQUi+hixfx6qN8Ja4Sc6dlRGCCxCzMM1dgKYb+tvTP/m1H9KXvnRNr371Bn+Kf+hP8y/r2962ouc8Z7v9+V988fThj/+MvOktl/qEDfb29gDEy+slFKmYYlDjFO9dLCTBbgnfaRqMciDDhqtKQDFVTQGZJHKb2H5xkqRiTl80YOWgx0C5cCh06gPcKdqhjdDsKRfNB8JXLmztgMdMkxs/RLI9IAYblDEyVswuGbd/fF3PRRxGDifGhtPQVYiSLXkQlMIrYJLP4FEmBSJWrFy4iTZsZLVyuFFpFTJ9tjozqfTbsNWtx4iTCrpoyQ0YY1Au/P9hzkHSaYjKZ0PmcquEeYotzviMil/CPgMR8zeIQoxg5AfeH6UgpdZSQhxDVVry7YOBmTxHolZeQMRgdMwEXZKMhbCJSEJMRXWA55WV8STj9xWfmqcP2DNu5KMUcCEvxWnSNp9ssLPa2W71u9f/6Nd+WL/rK3foR371BH/Kf+hP+wf0h35oh777u0+OfumXvmx1xyde1T7y0Yvzffdusbuz8p59rFXshuk9XFEuc3WBiTpyuvasnAOakPCi7L1L/z2GMhphGqG8YC8huw0rs292Y5Dv/0NlRxozg5Dt1t5PU4ed5VpxtHhVUgZJiOpDFquw+JNxOKnt3nOesdg5O1mJqSTBjnBJ8ZWiVUdc8OGBliI22lH9kSQJM0oh3w71X6kIQquOZPpZvW19Nee8pkhUlUyvqd0qJQVNqxhNE5yCZA7M8NyXQ8cRZS74CqIUl95eT0Vgj0M4dSqUL7ZkSIfrVQZlmqMjoRIzlsNqPRV+IhY+E6eke4OSauXtkxcPLTdBEZZKiLSleOZKhRnLcptt6LTStrmyxXU3rPtx//bpf/qFV/6fffn/Tx0AAKCvec0OveQlJ9vXvvaF05ve/iT9yB++UlW6rBtDlNzvLbMkQ8DTd62BVQNbUEP0sX6DxUlZhmCuKVepeXqD98/uzLMB0YKHZv8u+7S26PQpfNQ5IEzDjp8Hlo5rt7f32BaJFMMZtKLJhi63FRTdfGCcfHDERomNCahPZqptuFtPSpkUE3tsOxjVSup4frwSioEYwjwVsWrcsOgUXepbPyPmMsgrmcv2MrpqTef6c3qxzJlj7w+13cbjz7nCzkQ8sTKloj4sQzNvKSxME7URUD11cFtbQGKJZZRzBklNgBjHMsRWipJ8tFxBZ86eEYGtSvCo79iM2I2OepiKEapt26BCC/8Cm+jNB63+TI0U5LFeV+ZODz4g/JTbVl1Wf2n6u//83+ntL13T9//pyv7/4gMAAPR1r5tcXnj4nd/zhXt7u78jn/qk6u4uOfPOwy3hvnn1vTdC6AHbqY58dI80xmI/G6IiQ0x5kepZ8QMJhmwlqnnHYr98qu5KPy2pLi6M8V8G+QxSzECkPQgtntceE+66dSCNGzeqEJIcYXjPKVjwDhb52mWjENLaeC1KNePZh9EhcfzZxc3krjkuL4tLfG0VSllcFT2CNwKtbKmKHbMWE1qe8zJJ9eh3P2yCy0+nqysHj9hBF+ARWkqmuayIndDEBczu+CzmXEWqlriz8Rx6cA211B2EYtIPQmvQ83BJpapqj7aDSgXop0cK2SgVn9VghpwNMZuQR0vQKJfwGyJz4nfwfAw89wU4mS583e7L/9YvOtcP/wX/0H/JH9ZXvarhN36D6ZWv3G5+6J89e8X0Nv39d4CI0aWPiEyxVBfND9tvNqLyAi6+nfFhief+FRWcr+3HATNugpAfQ4LGU8faNdREa95aoRrFvymypBqbD58blc1A4QdwQrmiTDRfvJYSj3zfTkXsQtnr1vMlbl+VIuChU+syay+6J3C1HAyGrp6TpUAaoA+4LbdxGG8iRHJhT61ee0nLqlZ3TlnFUUJfw5Gnuc6tqs/qmAzJKzeztFL26VqyANTBL2IrxLwj/PcppW2i5mCSRGSpG3C4iIdKhBhxuG2ilKfiUVjYMWNWsNwYubKQGhddgoYatg5yCcuhdRwgxBCQtomIjq8prr+eNg8dfbN+/V9/6+4Xff0H9fbbJ/r+P17i+/+VAyA+OCML65vedO7qv//l5x1M0y/hnk+v5WSLLtLBaDrbYEPSIOTS4UCH1/5Rc3CYsAst0BkpvWTd3UmZRNcQToo+ugJJ1KqIcCFCFkgnolSIDc2BWZF9H6wEWjF07gm0kEFaSDaCR6pzGZZLCWOWLC/rcMq9CMqReqPINqUm8pIaYNXcgIHyshcKoaiTiO5S58r3opMoEVbkzk31lVjRcwRtUsKs40+UC5yovNyedY8I9ixmrWI39jXjGIL1oBr59zPUnJrVBRc9hE/mffhIxaZcwkThMFtK4xmV0JDk67silRaQDrYwmRiYepKVFIx3YWO6e7MyBINc5Ij8iWOQLQol7X1qOs1H1zbTs55/iOsf+d/RX/junzLLPtP3L339/5ceACW3VgFg+8u/9lXTxz7xg5s3vPHW9cH+uc0DDygxzzRNqzgZ7UMjaF1Ah+kmWG+haydb1yFz2Opt6q6tOLFN1KMFL27+bt9PB0wBObSMrxmzhoSL+FxCiibfdfDjFvb1WII6AhnFGWiSDxvy56/rLhpW0UBmaR6SUV3QKY4h6XLmUNU0VCbIvTgQY7denWyUbIYYylJivUhT4RaMwwrBKH6I00RpKoReDBx24Mtaftbe8POCRFQcVVUvYlN8j9Vi5iDpuk3Wp/EBOzHzjyv5fOBDPiRsDctpBmd6cR00FpqvVxDuLaE65A2Jsy7rXPNuqMcsN3TMW+HNdkXnzgAXLp1sd85+//q7f+R/VAd12//8r/Xe/lc7AP6of05e+WN/Y33Hx/6bzafv/vL1aofme+7Z6N4OMLWJGvGQNFJALame1ChOqtrLIflrPkgi9TiyvgyAUC1adC4gEX9nJAxAWphvSwAI8ubwOQSlmUbtRggzCNNiiOYk14xzLkw5qPXGsph4Z1T3kDSPd1xy8t24iKg0V33hK6i3Zhnqe0VjqK2RVed8AeMCghOhJt2ZV2FHDn0Dln83SjweW2RVeC2sTBZdjOcyUZerp2Ng3SqGi8okHCWEgzgn6KdfyEVFYOgw19e79n60T1r8KxIr47GzN9LRIq+vQGv9+WBavE5aI7rqULLoWFBUkSoyYz7pDbqD629E1/WmPfYxr8fnfc3P0Wd93iv1ba9Y0XO+fftn8Y7+mRwAqkp4/evDg3z8iv/17+y84wNPwv7et+PKFeD++zAzndDemnXkiI3RbNcCf9DAcyWMwH6JXIY1rKFsy4FOwYfFzVFSiMqKL9KM3DtvzkZx+2WdCBcaboiUijBFY/hFSbD1fTCKGKfLmC1U/pvKw8t/MS18OaAkbjnNFacRZ5yXnzj1Mi+gEsIZVdGyRPWYrUR1S8lR9FarZNh7OR3YbIRHxA1HznJk7+cXgzYspvnRSfgQ0CXQosuvH5AY+36ci0ca8vJFWxjWVU3psl8s9rvj2EAVBD0oicOSwJUhkc5E5FgtcrNNlADGDAjGBTn5N1pAQZ9nuvaQ8v7eDm6+GfOhfmi64YbXbV70TW/fedrz/tfaXv9ZXdJ/phWAvupVDW94w0Q/8iMnALD5Vz/5t/jd7zuQswd/YzX3R+HeuzBffkjRVlvemSDMjYmb9DmFAd6re8/PlOmEtDz1RQYFJsQ2Uib8UEhM9VOgAyutxW7ecQPJw3Xq4pZnjofRVVxuymBrbeKQcFQix9ayTNONIxdRT5I4bd8jGzAlKhoqHnxRY+ZZsESAPltuFN1953AQnwFYZsLItaPw12sRFLla0x17MayNOZittWyFJmLJSl6OB8KrADiZgl3ANtgNfQQXu3D93AsWK9oHzhTeMZjscQiooee058xhvJDja7IJwWKIWIfSWuCxnNZn0pSYuPIyac3eelBsREL/YPAYDEmxQvoWfUs4OtRGusaFi8CTb8P2o3f+3OrmG9+Kv/h3f50u3vifht7mu3Ze/4xv6C/6Y0Ae/z9xAFRHId7zHo6D4F3vevbql1/7+O21K0/Gwf7fXx0eT/jMvcDly5iPjwTchpilpWsPUyNqjdz4UjXkUO/R8gGPkrH6380OmohwWVp/Q/kngQ9Ds1LfHWNqstLKxvcV4EI8Yu489qK6YI2LccgBnyEHl0SbpxovX7a4be1BTRBFqT7SKx1Z86Eu8rg38WQeA7KWddiikrLijEpFke5EiTYmZMZWAYhN9WOf7/ttFyTZgRoy3OIEqnMhrapKnzFIMgDdRTpUn3lB4PRQ0Ev4cgDnFqL4I9pS5OXYNDdv1ZUheok5b84FUEUXI0sKSEeaUiNlungOWO0Bj3sK5oeO39c//O7v2/nzf3UXX/T1v0hEV/3FxxfeJn9WJf//JQeA//Oe229fP/2X7lZ6u+0upwknr3vd09dve+fB4fveK6tnPvM7V6rfgvvvBy7fDxwejehs7cDJCWaZhxc6Vngm3Soc9oWv23pe0QhMKgMyDW14sA0CS2FlcthQrfcs4A6Lto9hZGS5x3DRJ+oI3UEtS2NghISYaiQGyVL3DxqhEqE55lTM+SQf2apUeAeKBh9Vq16qirCi8R9xAHhlFNSmYl/VPr5km5JgZSjzuNlPDUsrGsuHq7FeRP5dOVKu3oAysI3foSxSiHw2RPafRVM0RrLc+Wv8T82EJLexhzlQykYIC2fl6McKnIUYbWekUWO1A+yeAdZngEs3Yj57w6f1A2/8Ruzunqxe9PWE277wU3Tmuo/HoXv7S9evfvpL+8sKs///7w6ARWvw3vfS6T2mqq4Pf/P3bsAnPgR86BPAfR/HZrVarx96aLN+8Zf8w2l391s2D13tDDLlT3lRg1CRhJpcASJfAGS8l7qkkwqXPRvKhQyYkIPFYPuhvFyoISBkZsZCGwZQzbY+6dJQ8nQEaKVIQHOyf3pFaP8K16BLLHIZweVX7KadCsMgLERMS6kwIuA0P4ZMYXKp9ahWJovuyuGn0kC0Z1YeJRDFB3iF9oPTg+2o6WuGbrGGI6PW/NChag4SLUae9Nk/7BmpZiybFVGcrBFEn+CROChbVn6qaOs1+s6ZTm31D49f+3OvOHPuUjtcnelnbr5ZcdPTCS/4yhM6d+4zix/x9hdMeOELgRf+/f5fc7L/p/nn/wPlvpRH0e2c6QAAAABJRU5ErkJggg==" },
];
const DEFAULT_LOGO_ID = "sunburst";
const SETTINGS_STORAGE_KEY = "internly:settings";
const ACCOUNT_STORAGE_KEY = "internly:account";

const DEGREE_LEVELS = ["Associate's", "Bachelor's", "Master's", "Doctorate"];
const BACHELOR_TYPES = ["B.S.", "B.A.", "B.B.A.", "B.F.A.", "Other"];
const GRAD_YEARS = (() => {
  const start = new Date().getFullYear() - 1;
  return Array.from({ length: 7 }, (_, i) => String(start + i));
})();

const emptySignup = () => ({
  name: "", email: "", password: "", confirmPassword: "",
});
const emptyProfile = () => ({
  school: "", major: "", degreeLevel: "Bachelor's", bachelorType: "B.S.",
  gpa: "", desiredRole: "", gradYear: "",
});

const GPA_STORAGE_KEY = "internly:gpa";
const DEFAULT_GRADE_SCALE = [
  { grade: "A+", points: "4.0" }, { grade: "A", points: "4.0" }, { grade: "A-", points: "3.67" },
  { grade: "B+", points: "3.3" }, { grade: "B", points: "3.0" }, { grade: "B-", points: "2.67" },
  { grade: "C+", points: "2.3" }, { grade: "C", points: "2.0" }, { grade: "C-", points: "2.0" },
  { grade: "D+", points: "1.3" }, { grade: "D", points: "1.0" }, { grade: "D-", points: "1.0" },
  { grade: "F", points: "0.0" },
];
const CATEGORIES = ["Major", "Gen-Ed", "Elective"];

const emptyCourse = () => ({
  id: uid(), courseId: "", name: "", credits: "3",
  category: "Gen-Ed", goalGrade: "A", actualGrade: "",
});
const emptySemester = () => ({ id: uid(), name: "", courses: [] });
const defaultGpaSettings = () => ({
  deansListThreshold: "3.5", degreeCredits: "120",
  gradeScale: DEFAULT_GRADE_SCALE.map((g) => ({ ...g })),
  showCumulativeChart: false,
  showCategoryBreakdown: false,
  showWhatIfCalculator: false,
  showGradeDistribution: false,
});

const scaleToPoints = (scale) =>
  Object.fromEntries((scale || []).filter((g) => g.grade).map((g) => [g.grade, parseFloat(g.points)]));
const scaleGrades = (scale) => (scale || []).filter((g) => g.grade).map((g) => g.grade);

// Stats for one semester - "actual" counts courses with a recorded grade,
// "goal" (predicted) counts every course using its goal grade.
function semesterGpa(semester, gradePoints) {
  const points_map = gradePoints || {};
  let actualPoints = 0, actualCredits = 0;
  let goalPoints = 0, goalCredits = 0;
  const byCategory = {};
  (semester.courses || []).forEach((c) => {
    const cr = parseFloat(c.credits);
    if (isNaN(cr)) return;
    const cat = c.category || "Elective";
    byCategory[cat] = byCategory[cat] || { planned: 0, completed: 0 };
    byCategory[cat].planned += cr;
    if (c.actualGrade && points_map[c.actualGrade] !== undefined) {
      actualPoints += cr * points_map[c.actualGrade];
      actualCredits += cr;
      byCategory[cat].completed += cr;
    }
    if (c.goalGrade && points_map[c.goalGrade] !== undefined) {
      goalPoints += cr * points_map[c.goalGrade];
      goalCredits += cr;
    }
  });
  return {
    actualGpa: actualCredits > 0 ? actualPoints / actualCredits : null,
    actualCredits, actualPoints,
    goalGpa: goalCredits > 0 ? goalPoints / goalCredits : null,
    goalCredits, goalPoints,
    byCategory,
  };
}

// Cumulative actual/goal stats across a list of semesters, in order.
function cumulativeGpa(semesters, gradePoints) {
  let actualPoints = 0, actualCredits = 0;
  let goalPoints = 0, goalCredits = 0;
  const byCategory = {};
  (semesters || []).forEach((s) => {
    const r = semesterGpa(s, gradePoints);
    actualPoints += r.actualPoints;
    actualCredits += r.actualCredits;
    goalPoints += r.goalPoints;
    goalCredits += r.goalCredits;
    Object.entries(r.byCategory).forEach(([cat, v]) => {
      byCategory[cat] = byCategory[cat] || { planned: 0, completed: 0 };
      byCategory[cat].planned += v.planned;
      byCategory[cat].completed += v.completed;
    });
  });
  return {
    gpa: actualCredits > 0 ? actualPoints / actualCredits : null,
    credits: actualCredits,
    goalGpa: goalCredits > 0 ? goalPoints / goalCredits : null,
    byCategory,
  };
}

function gpaNeeded(targetGpa, creditsBefore, gpaBefore, creditsThis) {
  const t = parseFloat(targetGpa), cb = parseFloat(creditsBefore) || 0,
    gb = parseFloat(gpaBefore) || 0, ct = parseFloat(creditsThis);
  if (isNaN(t) || isNaN(ct) || ct <= 0) return null;
  const needed = (t * (cb + ct) - gb * cb) / ct;
  return needed;
}

const SCHOLARSHIP_STORAGE_KEY = "internly:scholarships";
const SCHOLARSHIP_STATUSES = ["Researching", "Applying", "Submitted", "Awarded", "Rejected"];
const SCHOLARSHIP_STATUS_META = {
  Researching: { label: "Researching", dot: "#B48CFF" },
  Applying: { label: "Applying", dot: "#3DA5FF" },
  Submitted: { label: "Submitted", dot: "#FFB400" },
  Awarded: { label: "Awarded", dot: "#2FBF71" },
  Rejected: { label: "Rejected", dot: "#FF5C5C" },
};
const emptyScholarship = () => ({
  id: uid(), name: "", sponsor: "", amount: "", deadline: "",
  status: "Researching", renewable: "No", essayRequired: "No", link: "", requirements: "", notes: "",
});

const VOLUNTEER_STORAGE_KEY = "internly:volunteering";
const VOLUNTEER_STATUSES = ["Researching", "Applied", "Confirmed", "Completed"];
const VOLUNTEER_STATUS_META = {
  Researching: { label: "Researching", dot: "#B48CFF" },
  Applied: { label: "Applied", dot: "#3DA5FF" },
  Confirmed: { label: "Confirmed", dot: "#FFB400" },
  Completed: { label: "Completed", dot: "#2FBF71" },
};
const emptyVolunteer = () => ({
  id: uid(), organization: "", role: "", hours: "", date: "",
  status: "Researching", location: "", link: "", notes: "",
});

const STORAGE_KEY = "internly:applications";

const STATUSES = ["Researching", "Applied", "Interviewing", "Offer", "Rejected"];

const STATUS_META = {
  Researching:  { label: "Researching", dot: "#B48CFF" },
  Applied:      { label: "Applied",      dot: "#3DA5FF" },
  Interviewing: { label: "Interviewing", dot: "#FFB400" },
  Offer:        { label: "Offer",        dot: "#2FBF71" },
  Rejected:     { label: "Rejected",     dot: "#FF5C5C" },
};

const WORK_TYPES = ["Remote", "Hybrid", "In-Person"];
const INTEREST_LEVELS = ["Low", "Medium", "High"];

const uid = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const seedData = () => [
  {
    id: uid(), company: "BDO", jobTitle: "Assurance Intern - Summer 2027",
    status: "Applied", location: "Baltimore, MD", workType: "In-Person",
    deadline: "2027-04-07", dateApplied: "2026-08-09", hourlyRate: "34",
    salary: "", link: "", interest: "Medium", notes: "", interviews: [],
  },
  {
    id: uid(), company: "BDO", jobTitle: "Assurance Intern - Winter 2027",
    status: "Applied", location: "Baltimore, MD", workType: "In-Person",
    deadline: "2027-10-07", dateApplied: "2025-11-03", hourlyRate: "34",
    salary: "", link: "", interest: "Low", notes: "", interviews: [],
  },
  {
    id: uid(), company: "MD Democratic Party", jobTitle: "Finance Intern",
    status: "Rejected", location: "Annapolis, MD", workType: "Hybrid",
    deadline: "2026-09-05", dateApplied: "2026-08-09", hourlyRate: "20",
    salary: "", link: "", interest: "Medium", notes: "", interviews: [],
  },
  {
    id: uid(), company: "Deloitte", jobTitle: "", status: "Researching",
    location: "", workType: "In-Person", deadline: "", dateApplied: "",
    hourlyRate: "", salary: "", link: "", interest: "Medium", notes: "", interviews: [],
  },
  {
    id: uid(), company: "Nestlé", jobTitle: "", status: "Researching",
    location: "", workType: "Hybrid", deadline: "", dateApplied: "",
    hourlyRate: "", salary: "", link: "", interest: "Medium", notes: "", interviews: [],
  },
  {
    id: uid(), company: "CohnReznick", jobTitle: "", status: "Researching",
    location: "", workType: "In-Person", deadline: "", dateApplied: "",
    hourlyRate: "", salary: "", link: "", interest: "Medium", notes: "", interviews: [],
  },
  {
    id: uid(), company: "Ellis & Turner", jobTitle: "", status: "Researching",
    location: "", workType: "Hybrid", deadline: "", dateApplied: "",
    hourlyRate: "", salary: "", link: "", interest: "Medium", notes: "", interviews: [],
  },
];

const emptyDraft = () => ({
  id: null, company: "", jobTitle: "", status: "Researching", location: "",
  workType: "In-Person", deadline: "", dateApplied: "", hourlyRate: "",
  salary: "", link: "", interest: "Medium", notes: "", interviews: [],
});

const emptyInterview = () => ({
  date: "", time: "", type: "Video", location: "", notes: "",
});

const normalizeApps = (list) =>
  (list || []).map((a) => ({ ...a, interviews: a.interviews || [] }));

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + "T00:00:00");
  return Math.round((d - today) / 86400000);
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + "T00:00:00");
  return Math.round((today - d) / 86400000);
}

function DeadlineChip({ deadline }) {
  const days = daysUntil(deadline);
  if (days === null) {
    return <span className="chip chip-muted">No deadline</span>;
  }
  let cls = "chip-ok", text = `${days}d left`;
  if (days < 0) { cls = "chip-past"; text = "Past due"; }
  else if (days === 0) { cls = "chip-urgent"; text = "Due today"; }
  else if (days <= 7) { cls = "chip-urgent"; text = `${days}d left`; }
  else if (days <= 21) { cls = "chip-soon"; text = `${days}d left`; }
  return <span className={`chip ${cls}`}><Clock size={11} strokeWidth={2.5} />{text}</span>;
}

function AppliedChip({ dateApplied }) {
  const days = daysSince(dateApplied);
  if (days === null) return null;
  let text;
  if (days <= 0) text = "Applied today";
  else if (days === 1) text = "Applied 1d ago";
  else text = `Applied ${days}d ago`;
  return <span className="chip chip-applied"><History size={11} strokeWidth={2.5} />{text}</span>;
}

const INTERVIEW_TYPES = ["Phone", "Video", "In-Person"];

function InterviewTypeIcon({ type, size = 12 }) {
  if (type === "Phone") return <Phone size={size} strokeWidth={2.2} />;
  if (type === "In-Person") return <MapPin size={size} strokeWidth={2.2} />;
  return <Video size={size} strokeWidth={2.2} />;
}

const isUrl = (str) => /^https?:\/\//i.test((str || "").trim());

function interviewDateTime(iv) {
  if (!iv.date) return null;
  return new Date(`${iv.date}T${iv.time || "00:00"}:00`);
}

function formatInterviewDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function formatInterviewTime(timeStr) {
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m || 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function nextUpcomingInterview(interviews) {
  if (!interviews || interviews.length === 0) return null;
  const now = new Date();
  const upcoming = interviews
    .map((iv) => ({ iv, dt: interviewDateTime(iv) }))
    .filter((x) => x.dt && x.dt >= now)
    .sort((a, b) => a.dt - b.dt);
  return upcoming.length ? upcoming[0] : null;
}

function InterviewChip({ interviews }) {
  const next = nextUpcomingInterview(interviews);
  if (!next) return null;
  const days = daysUntil(next.iv.date);
  let text;
  if (days === 0) text = "Interview today";
  else if (days === 1) text = "Interview in 1d";
  else text = `Interview in ${days}d`;
  return (
    <span className="chip chip-interview">
      <InterviewTypeIcon type={next.iv.type} size={11} />
      {text}
    </span>
  );
}

function WorkTypeIcon({ type }) {
  if (type === "Remote") return <Wifi size={13} strokeWidth={2.2} />;
  if (type === "Hybrid") return <Home size={13} strokeWidth={2.2} />;
  return <Building2 size={13} strokeWidth={2.2} />;
}

function InterestDots({ level }) {
  const n = level === "High" ? 3 : level === "Medium" ? 2 : 1;
  return (
    <span className="interest-dots" title={`Interest: ${level}`}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={`dot ${i < n ? "dot-on" : ""}`} />
      ))}
    </span>
  );
}

function PasswordInput({ value, onChange, placeholder, onKeyDown, autoFocus, maxLength }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="input-with-icon password-input">
      <Lock size={13} />
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
        maxLength={maxLength}
      />
      <button
        type="button"
        className="password-toggle"
        onClick={() => setVisible((v) => !v)}
        tabIndex={-1}
        aria-label={visible ? "Hide password" : "Show password"}
        title={visible ? "Hide password" : "Show password"}
      >
        {visible ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

function WelcomePage({ onContinue, onLogin, logoId }) {
  return (
    <div className="welcome-stage">
      <AuraBackground tall contentClassName="aura-content-welcome">
        <div className="welcome-brand">
          <Logo logoId={logoId} size={52} />
          <span className="welcome-brand-name">internly</span>
        </div>
        <h1 className="welcome-title">Your internship search, all in one place</h1>
        <p className="welcome-sub">
          Track applications, interviews, GPA, and scholarships, everything a student needs, built into one clean app.
        </p>

        <div className="feature-grid welcome-feature-grid">
          {FEATURE_LIST.map((f) => (
            <TiltCard as="div" className="feature-card" key={f.title}>
              <span className="feature-icon"><f.icon size={16} /></span>
              <span className="feature-title">{f.title}</span>
              <span className="feature-text">{f.text}</span>
            </TiltCard>
          ))}
        </div>

        <button className="btn btn-primary welcome-cta" onClick={onContinue}>
          Get started
          <ArrowRight size={15} />
        </button>
        <button type="button" className="auth-link welcome-login-link" onClick={onLogin}>
          Already have an account? Log in
        </button>
      </AuraBackground>
    </div>
  );
}

function LoginFlow({ onLogin, onBack, onLogoClick, logoId, defaultEmail }) {
  const [email, setEmail] = useState(defaultEmail || "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  // Client-side lockout after repeated failed attempts. Note: Supabase's
  // Auth server also enforces its own rate limits on sign-in requests
  // regardless of this client-side layer, so brute-forcing is blocked
  // even if someone bypasses this UI.
  const MAX_ATTEMPTS = 5;
  const COOLDOWN_MS = 30000;

  useEffect(() => {
    if (!cooldownUntil) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
      setCooldownRemaining(remaining);
      if (remaining <= 0) {
        setCooldownUntil(0);
        setFailedAttempts(0);
      }
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [cooldownUntil]);

  const isLockedOut = cooldownUntil > Date.now();

  const handleLogin = async () => {
    if (isLockedOut) return;
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setError("");
    setChecking(true);
    const result = await onLogin(email.trim(), password);
    setChecking(false);
    if (!result.success) {
      const next = failedAttempts + 1;
      setFailedAttempts(next);
      if (next >= MAX_ATTEMPTS) {
        setCooldownUntil(Date.now() + COOLDOWN_MS);
        setError(`Too many attempts. Try again in ${Math.ceil(COOLDOWN_MS / 1000)}s.`);
      } else {
        setError(result.message || "That email and password don't match our records.");
      }
    } else {
      setFailedAttempts(0);
    }
  };

  return (
    <div className="auth-stage">
      <div className="auth-card">
        <div
          className="auth-brand"
          onClick={onLogoClick}
          role={onLogoClick ? "button" : undefined}
          tabIndex={onLogoClick ? 0 : undefined}
          onKeyDown={onLogoClick ? (e) => { if (e.key === "Enter" || e.key === " ") onLogoClick(); } : undefined}
          style={onLogoClick ? { cursor: "pointer" } : undefined}
          aria-label={onLogoClick ? "Internly, back to welcome" : undefined}
        >
          <Logo logoId={logoId} size={44} />
          <span className="auth-brand-name">internly</span>
        </div>

        <h2 className="auth-title">{defaultEmail ? "Welcome back" : "Log in"}</h2>
        <p className="auth-sub">Enter the email and password you signed up with.</p>

        {error && <div className="auth-error">{error}</div>}

        <label className="auth-field">
          Email
          <div className="input-with-icon">
            <Mail size={13} />
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(""); }}
              placeholder="jane@gmail.com"
              autoFocus={!defaultEmail}
            />
          </div>
        </label>
        <label className="auth-field">
          Password
          <PasswordInput
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(""); }}
            placeholder="Your password"
            autoFocus={!!defaultEmail}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
          />
        </label>

        <button className="btn btn-primary auth-submit" onClick={handleLogin} disabled={checking || isLockedOut}>
          {isLockedOut ? `Try again in ${cooldownRemaining}s` : checking ? "Checking…" : "Log in"}
          {!checking && !isLockedOut && <ArrowRight size={14} />}
        </button>

        <button type="button" className="auth-link" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}

function AuthFlow({ onComplete, onLogin, onLogoClick, logoId }) {
  const [step, setStep] = useState(1);
  const [signup, setSignup] = useState(emptySignup());
  const [profile, setProfile] = useState(emptyProfile());
  const [error, setError] = useState("");

  const setSignupField = (k) => (e) => setSignup({ ...signup, [k]: e.target.value });
  const setProfileField = (k) => (e) => setProfile({ ...profile, [k]: e.target.value });

  const validateSignup = () => {
    const name = signup.name.trim();
    const email = signup.email.trim();
    if (!name) return "Enter your name.";
    if (name.length > 100) return "Name is too long (max 100 characters).";
    if (!email) return "Enter your email.";
    if (email.length > 254) return "Email is too long.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address.";
    if (signup.password.length < 6) return "Password must be at least 6 characters.";
    if (signup.password.length > 200) return "Password is too long.";
    if (signup.password !== signup.confirmPassword) return "Passwords don't match.";
    return "";
  };

  const handleContinue = () => {
    const err = validateSignup();
    if (err) { setError(err); return; }
    setError("");
    setStep(2);
  };

  const [submitting, setSubmitting] = useState(false);

  const finish = async (skipProfile) => {
    setError("");
    setSubmitting(true);
    try {
      await onComplete({
        name: signup.name.trim(),
        email: signup.email.trim(),
        password: signup.password,
        profile: skipProfile ? emptyProfile() : { ...profile },
      });
    } catch (e) {
      setError(e.message || "Couldn't create your account. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-stage">
      <div className="auth-card">
        <div
          className="auth-brand"
          onClick={onLogoClick}
          role={onLogoClick ? "button" : undefined}
          tabIndex={onLogoClick ? 0 : undefined}
          onKeyDown={onLogoClick ? (e) => { if (e.key === "Enter" || e.key === " ") onLogoClick(); } : undefined}
          style={onLogoClick ? { cursor: "pointer" } : undefined}
          aria-label={onLogoClick ? "Internly, back to welcome" : undefined}
        >
          <Logo logoId={logoId} size={44} />
          <span className="auth-brand-name">internly</span>
        </div>

        <div className="auth-progress">
          <span className={`auth-dot ${step === 1 ? "auth-dot-active" : ""}`} />
          <span className={`auth-dot ${step === 2 ? "auth-dot-active" : ""}`} />
        </div>

        {step === 1 ? (
          <>
            <h2 className="auth-title">Create your account</h2>
            <p className="auth-sub">Track your internship search in one place.</p>

            {error && <div className="auth-error">{error}</div>}

            <label className="auth-field">
              Full name
              <div className="input-with-icon">
                <User size={13} />
                <input value={signup.name} onChange={setSignupField("name")} placeholder="Jane Doe" autoFocus maxLength={100} />
              </div>
            </label>
            <label className="auth-field">
              Email
              <div className="input-with-icon">
                <Mail size={13} />
                <input type="email" value={signup.email} onChange={setSignupField("email")} placeholder="jane@gmail.com" maxLength={254} />
              </div>
            </label>
            <label className="auth-field">
              Password
              <PasswordInput
                value={signup.password}
                onChange={setSignupField("password")}
                placeholder="At least 6 characters"
                maxLength={200}
              />
            </label>
            <label className="auth-field">
              Confirm password
              <PasswordInput
                value={signup.confirmPassword}
                onChange={setSignupField("confirmPassword")}
                placeholder="Re-enter password"
                onKeyDown={(e) => e.key === "Enter" && handleContinue()}
                maxLength={200}
              />
            </label>

            <button className="btn btn-primary auth-submit" onClick={handleContinue}>
              Continue
              <ArrowRight size={14} />
            </button>
            {onLogin && (
              <button type="button" className="auth-link" onClick={onLogin}>
                Already have an account? Log in
              </button>
            )}
            <p className="auth-disclaimer">
              Internly is an independent tracking tool for your own use. It isn't affiliated with,
              endorsed by, or connected to any school, university, employer, or career site.
            </p>
          </>
        ) : (
          <>
            <h2 className="auth-title">Tell us about yourself</h2>
            <p className="auth-sub">This helps tailor Internly to you. Change it anytime in Settings.</p>

            {error && <div className="auth-error">{error}</div>}

            <div className="auth-field-row">
              <label className="auth-field">
                School
                <input value={profile.school} onChange={setProfileField("school")} placeholder="e.g. University of Maryland" autoFocus maxLength={150} />
              </label>
              <label className="auth-field">
                Major
                <MajorInput value={profile.major} onChange={(v) => setProfile({ ...profile, major: v })} />
              </label>
            </div>

            <div className="auth-field-row">
              <label className="auth-field">
                Degree level
                <select value={profile.degreeLevel} onChange={setProfileField("degreeLevel")}>
                  {DEGREE_LEVELS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
              <label className="auth-field">
                Expected graduation
                <select value={profile.gradYear} onChange={setProfileField("gradYear")}>
                  <option value="">Select year</option>
                  {GRAD_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </label>
            </div>

            <div className="auth-field-row">
              {profile.degreeLevel === "Bachelor's" ? (
                <label className="auth-field">
                  Degree type
                  <select value={profile.bachelorType} onChange={setProfileField("bachelorType")}>
                    {BACHELOR_TYPES.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </label>
              ) : (
                <label className="auth-field">
                  Degree type
                  <input value={profile.bachelorType} onChange={setProfileField("bachelorType")} placeholder="e.g. M.S., Ph.D." />
                </label>
              )}
              <label className="auth-field">
                GPA
                <input value={profile.gpa} onChange={setProfileField("gpa")} placeholder="e.g. 3.75" inputMode="decimal" />
              </label>
            </div>

            <label className="auth-field">
              Desired role
              <input
                value={profile.desiredRole}
                onChange={setProfileField("desiredRole")}
                placeholder="e.g. Software Engineering Intern"
                onKeyDown={(e) => e.key === "Enter" && finish(false)}
              />
            </label>

            <div className="auth-actions-row">
              <button className="btn btn-ghost" onClick={() => setStep(1)} disabled={submitting}>
                <ArrowLeft size={13} />
                Back
              </button>
              <button className="btn btn-ghost" onClick={() => finish(true)} disabled={submitting}>
                <SkipForward size={13} />
                Skip for now
              </button>
              <button className="btn btn-primary" onClick={() => finish(false)} disabled={submitting}>
                {submitting ? "Creating…" : "Finish"}
                {!submitting && <Check size={14} />}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SignInFlow({ pendingAccount, onSignIn, onReset, logoId }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);

  const handleSignIn = () => {
    if (password !== pendingAccount.password) {
      setError("Incorrect password.");
      return;
    }
    setError("");
    onSignIn();
  };

  const firstName = (pendingAccount.name || "").split(" ")[0] || "back";

  return (
    <div className="auth-stage">
      <div className="auth-card">
        <div className="auth-brand">
          <Logo logoId={logoId} size={44} />
          <span className="auth-brand-name">internly</span>
        </div>

        <h2 className="auth-title">Welcome back, {firstName}</h2>
        <p className="auth-sub">Sign in as {pendingAccount.email} to pick up where you left off.</p>

        {error && <div className="auth-error">{error}</div>}

        <label className="auth-field">
          Password
          <PasswordInput
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(""); }}
            placeholder="Enter your password"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && handleSignIn()}
          />
        </label>

        <button className="btn btn-primary auth-submit" onClick={handleSignIn}>
          Sign in
          <ArrowRight size={14} />
        </button>

        {confirmReset ? (
          <div className="auth-reset-confirm">
            <span>This clears the saved account on this device. Your tracked internships stay put. Continue?</span>
            <div className="auth-actions-row">
              <button className="btn btn-ghost" onClick={() => setConfirmReset(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={onReset}>
                <LogOut size={13} />
                Start over
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="auth-link" onClick={() => setConfirmReset(true)}>
            Not you? Start over
          </button>
        )}
      </div>
    </div>
  );
}

function Logo({ size = 34, logoId = DEFAULT_LOGO_ID }) {
  const src = (LOGO_OPTIONS.find((l) => l.id === logoId) || LOGO_OPTIONS[0]).src;
  return (
    <span className="logo-mark" style={{ width: size, height: size }}>
      <img src={src} alt="Internly" className="logo-img" />
    </span>
  );
}

function InternlyApp() {
  const [apps, setApps] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState(false);
  const [section, setSection] = useState("dashboard");
  const [view, setView] = useState("board");
  const [filter, setFilter] = useState("All");
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState("deadline");
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState(emptyDraft());
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [quickViewId, setQuickViewId] = useState(null);
  const [quickSaveOpen, setQuickSaveOpen] = useState(false);
  const [quickSaveDraft, setQuickSaveDraft] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("internly:draft-quicksave") || "null");
      return saved && typeof saved === "object" ? { company: "", link: "", ...saved } : { company: "", link: "" };
    } catch (e) {
      return { company: "", link: "" };
    }
  });
  useEffect(() => {
    try {
      if (quickSaveDraft.company || quickSaveDraft.link) {
        localStorage.setItem("internly:draft-quicksave", JSON.stringify(quickSaveDraft));
      } else {
        localStorage.removeItem("internly:draft-quicksave");
      }
    } catch (e) {
      // non-fatal - draft autosave is best-effort
    }
  }, [quickSaveDraft]);
  const [logoId, setLogoId] = useState(DEFAULT_LOGO_ID);
  const [favoriteGames, setFavoriteGames] = useState([]);
  const [showAllFilter, setShowAllFilterState] = useState(true);
  const [account, setAccount] = useState(null);
  const [showWelcome, setShowWelcome] = useState(true);
  const [manualLoginMode, setManualLoginMode] = useState(false);
  const [accountLoading, setAccountLoading] = useState(true);
  const [lastEmail, setLastEmail] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLastEmail(sbGetLastEmail());
      try {
        const session = await sbGetValidSession();
        if (session?.access_token) {
          const profile = (await sbGetData("profile")) || emptyProfile();
          if (!cancelled) {
            setAccount({
              name: session.user?.user_metadata?.name || "",
              email: session.user?.email || "",
              profile,
            });
            setShowWelcome(false);
          }
        }
      } catch (e) {
        // treat as signed out - the session may have expired
        sbSaveSession(null);
      } finally {
        if (!cancelled) setAccountLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // accountData: { name, email, password, profile }
  const completeSignup = useCallback(async (accountData) => {
    const result = await sbSignUp(accountData.email, accountData.password, accountData.name);
    if (!result.access_token) {
      // Project has "Confirm email" turned on - no session yet.
      throw new Error("Check your email to confirm your account, then log in.");
    }
    await sbSetData("profile", accountData.profile);
    setAccount({ name: accountData.name, email: accountData.email, profile: accountData.profile });
    sbSaveLastEmail(accountData.email);
    setLastEmail(accountData.email);
  }, []);

  const updateAccount = useCallback(async (next) => {
    setAccount(next);
    try {
      await sbSetData("profile", next.profile);
    } catch (e) {
      // non-fatal
    }
  }, []);

  const signOut = useCallback(async () => {
    await sbSignOut();
    setAccount(null);
    setShowWelcome(false);
    setManualLoginMode(true);
    setSection("dashboard");
  }, []);

  const deleteAccount = useCallback(async () => {
    const session = await sbGetValidSession();
    if (!session?.access_token) {
      return { success: false, message: "You're not signed in. Refresh the page and try again." };
    }
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-account`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      let data = null;
      try {
        data = await res.json();
      } catch (e) {
        // response had no JSON body - fall through to the res.ok check below
      }
      if (!res.ok || data?.error) {
        // The account was NOT actually deleted on the server - do not sign
        // the user out or clear local state, or it would look like deletion
        // succeeded when it didn't.
        return {
          success: false,
          message: data?.error || "The server couldn't delete your account. Please try again in a moment.",
        };
      }
    } catch (e) {
      // Network-level failure (offline, CORS, etc.) - the function never ran.
      return { success: false, message: "Couldn't reach the server. Check your connection and try again." };
    }

    // Only reached if the Edge Function confirmed the auth user was deleted.
    await sbSignOut();
    setAccount(null);
    setShowWelcome(false);
    setManualLoginMode(true);
    setSection("dashboard");
    return { success: true };
  }, []);

  const manualLogin = useCallback(async (email, password) => {
    try {
      const session = await sbSignIn(email, password);
      const profile = (await sbGetData("profile")) || emptyProfile();
      setAccount({
        name: session.user?.user_metadata?.name || "",
        email: session.user?.email || email,
        profile,
      });
      sbSaveLastEmail(email);
      setLastEmail(email);
      setManualLoginMode(false);
      setShowWelcome(false);
      setSection("dashboard");
      return { success: true };
    } catch (e) {
      return { success: false, reason: "mismatch", message: e.message };
    }
  }, []);

  const resetAccount = useCallback(async () => {
    await sbSignOut();
    setAccount(null);
    setManualLoginMode(false);
    setShowWelcome(true);
  }, []);

  const [semesters, setSemesters] = useState(null);
  const [gpaSettings, setGpaSettings] = useState(defaultGpaSettings());
  const [gpaLoading, setGpaLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const parsed = await sbGetData("gpa");
        if (!cancelled) {
          if (Array.isArray(parsed)) {
            // legacy format - plain array of semesters, no settings
            setSemesters(parsed);
            setGpaSettings(defaultGpaSettings());
          } else if (parsed) {
            setSemesters(parsed.semesters || []);
            setGpaSettings({ ...defaultGpaSettings(), ...(parsed.settings || {}) });
          } else {
            setSemesters([]);
          }
        }
      } catch (e) {
        if (!cancelled) setSemesters([]);
      } finally {
        if (!cancelled) setGpaLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [account]);

  const persistGpaState = useCallback(async (nextSemesters, nextSettings) => {
    setSemesters(nextSemesters);
    setGpaSettings(nextSettings);
    try {
      await sbSetData("gpa", { semesters: nextSemesters, settings: nextSettings });
      setSaveError(false);
    } catch (e) {
      setSaveError(true);
    }
  }, []);

  const persistSemesters = useCallback((next) => {
    persistGpaState(next, gpaSettings);
  }, [persistGpaState, gpaSettings]);

  const persistGpaSettings = useCallback((next) => {
    persistGpaState(semesters || [], next);
  }, [persistGpaState, semesters]);

  const syncGpaToProfile = useCallback((gpaValue) => {
    if (!account) return;
    updateAccount({ ...account, profile: { ...account.profile, gpa: gpaValue } });
  }, [account, updateAccount]);

  const [scholarships, setScholarships] = useState(null);
  const [scholarshipsLoading, setScholarshipsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const parsed = await sbGetData("scholarships");
        if (!cancelled) setScholarships(parsed || []);
      } catch (e) {
        if (!cancelled) setScholarships([]);
      } finally {
        if (!cancelled) setScholarshipsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [account]);

  const persistScholarships = useCallback(async (next) => {
    setScholarships(next);
    try {
      await sbSetData("scholarships", next);
      setSaveError(false);
    } catch (e) {
      setSaveError(true);
    }
  }, []);

  const [volunteering, setVolunteering] = useState(null);
  const [volunteeringLoading, setVolunteeringLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const parsed = await sbGetData("volunteering");
        if (!cancelled) setVolunteering(parsed || []);
      } catch (e) {
        if (!cancelled) setVolunteering([]);
      } finally {
        if (!cancelled) setVolunteeringLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [account]);

  const persistVolunteering = useCallback(async (next) => {
    setVolunteering(next);
    try {
      await sbSetData("volunteering", next);
      setSaveError(false);
    } catch (e) {
      setSaveError(true);
    }
  }, []);

  // Load from persistent storage
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const parsed = await sbGetData("applications");
        if (!cancelled) {
          setApps(parsed ? normalizeApps(parsed) : []);
        }
      } catch (e) {
        if (!cancelled) setApps([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [account]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await sbGetData("settings");
        if (!cancelled && settings) {
          if (settings.logoId && LOGO_OPTIONS.some((l) => l.id === settings.logoId)) {
            setLogoId(settings.logoId);
          }
          if (Array.isArray(settings.favoriteGames)) {
            setFavoriteGames(settings.favoriteGames);
          }
          if (typeof settings.showAllFilter === "boolean") {
            setShowAllFilterState(settings.showAllFilter);
          }
        }
      } catch (e) {
        // keep defaults
      }
    })();
    return () => { cancelled = true; };
  }, [account]);

  const changeLogo = useCallback(async (id) => {
    setLogoId(id);
    try {
      await sbSetData("settings", { logoId: id, favoriteGames, showAllFilter });
    } catch (e) {
      // non-fatal - logo choice just won't persist
    }
  }, [favoriteGames, showAllFilter]);

  const toggleFavoriteGame = useCallback((title) => {
    setFavoriteGames((current) => {
      const next = current.includes(title) ? current.filter((t) => t !== title) : [...current, title];
      sbSetData("settings", { logoId, favoriteGames: next, showAllFilter }).catch(() => {});
      return next;
    });
  }, [logoId, showAllFilter]);

  const setShowAllFilter = useCallback((value) => {
    setShowAllFilterState(value);
    sbSetData("settings", { logoId, favoriteGames, showAllFilter: value }).catch(() => {});
  }, [logoId, favoriteGames]);

  // If "All" gets hidden while it's the active filter, fall back to the
  // first real status instead of leaving the page stuck on a filter that
  // no longer has a visible chip.
  useEffect(() => {
    if (!showAllFilter && filter === "All") {
      setFilter(STATUSES[0]);
    }
  }, [showAllFilter, filter]);

  const persist = useCallback(async (next) => {
    setApps(next);
    try {
      await sbSetData("applications", next);
      setSaveError(false);
    } catch (e) {
      setSaveError(true);
    }
  }, []);

  const openAdd = (status) => {
    setDraft({ ...emptyDraft(), status: status || "Researching" });
    setModalOpen(true);
  };
  const openEdit = (item) => {
    setDraft({ ...item });
    setModalOpen(true);
  };
  const closeModal = () => setModalOpen(false);

  const saveDraft = () => {
    if (!draft.company.trim()) return;
    const isNew = !draft.id;
    const record = { ...draft, id: draft.id || uid() };
    const next = isNew
      ? [...(apps || []), record]
      : (apps || []).map((a) => (a.id === record.id ? record : a));
    persist(next);
    setModalOpen(false);
  };

  const removeApp = (id) => {
    persist((apps || []).filter((a) => a.id !== id));
    setConfirmDelete(null);
  };

  const changeStatus = (id, status) => {
    persist((apps || []).map((a) => (a.id === id ? { ...a, status } : a)));
  };

  const openQuickView = (item) => setQuickViewId(item.id);
  const closeQuickView = () => setQuickViewId(null);
  const quickViewItem = quickViewId ? (apps || []).find((a) => a.id === quickViewId) || null : null;

  const openQuickSave = () => {
    setQuickSaveOpen(true);
  };
  const closeQuickSave = () => setQuickSaveOpen(false);
  const saveQuickAdd = () => {
    if (!quickSaveDraft.company.trim()) return;
    const record = {
      ...emptyDraft(),
      id: uid(),
      company: quickSaveDraft.company.trim(),
      link: quickSaveDraft.link.trim(),
    };
    persist([...(apps || []), record]);
    setQuickSaveOpen(false);
    setQuickSaveDraft({ company: "", link: "" });
  };
  const saveQuickAddAndEdit = () => {
    if (!quickSaveDraft.company.trim()) return;
    const record = {
      ...emptyDraft(),
      id: uid(),
      company: quickSaveDraft.company.trim(),
      link: quickSaveDraft.link.trim(),
    };
    persist([...(apps || []), record]);
    setQuickSaveOpen(false);
    setQuickSaveDraft({ company: "", link: "" });
    openEdit(record);
  };

  const filtered = useMemo(() => {
    if (!apps) return [];
    let list = apps;
    if (filter !== "All") list = list.filter((a) => a.status === filter);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (a) =>
          a.company.toLowerCase().includes(q) ||
          (a.jobTitle || "").toLowerCase().includes(q) ||
          (a.location || "").toLowerCase().includes(q)
      );
    }
    const sorted = [...list].sort((a, b) => {
      if (sortBy === "deadline") {
        const da = a.deadline ? new Date(a.deadline) : new Date("9999-12-31");
        const db = b.deadline ? new Date(b.deadline) : new Date("9999-12-31");
        return da - db;
      }
      if (sortBy === "company") return a.company.localeCompare(b.company);
      if (sortBy === "applied") {
        const da = a.dateApplied ? new Date(a.dateApplied) : new Date(0);
        const db = b.dateApplied ? new Date(b.dateApplied) : new Date(0);
        return db - da;
      }
      return 0;
    });
    return sorted;
  }, [apps, filter, query, sortBy]);

  const byStatus = useMemo(() => {
    const map = {};
    STATUSES.forEach((s) => (map[s] = []));
    filtered.forEach((a) => map[a.status] && map[a.status].push(a));
    return map;
  }, [filtered]);

  const stats = useMemo(() => {
    if (!apps) return { total: 0, active: 0, offers: 0, soon: 0 };
    const active = apps.filter((a) => a.status === "Applied" || a.status === "Interviewing").length;
    const offers = apps.filter((a) => a.status === "Offer").length;
    const soon = apps.filter((a) => {
      const d = daysUntil(a.deadline);
      return d !== null && d >= 0 && d <= 14;
    }).length;
    return { total: apps.length, active, offers, soon };
  }, [apps]);

  if (accountLoading) {
    return (
      <div className="internly-root">
        <style>{CSS}</style>
        <div className="boot-loading">
          <Loader2 className="spin" size={22} />
        </div>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="internly-root">
        <style>{CSS}</style>
        {manualLoginMode ? (
          <LoginFlow
            onLogin={manualLogin}
            onBack={() => setManualLoginMode(false)}
            onLogoClick={() => { setManualLoginMode(false); setShowWelcome(true); }}
            logoId={logoId}
            defaultEmail={lastEmail}
          />
        ) : showWelcome ? (
          <WelcomePage
            onContinue={() => setShowWelcome(false)}
            onLogin={() => setManualLoginMode(true)}
            logoId={logoId}
          />
        ) : (
          <AuthFlow
            onComplete={completeSignup}
            onLogin={() => setManualLoginMode(true)}
            onLogoClick={() => setShowWelcome(true)}
            logoId={logoId}
          />
        )}
      </div>
    );
  }

  return (
    <div className="internly-root">
      <style>{CSS}</style>
      <a href="#main-content" className="skip-link">Skip to main content</a>

      <header className="topbar">
        <div className="brand">
          <Logo logoId={logoId} />
          <div className="brand-text">
            {logoId === "sunburst" && <span className="brand-name">internly</span>}
            <span className="brand-tag">Find it. Track it. Land it.</span>
          </div>
        </div>
        <div className="header-actions">
          <nav className="view-tabs" aria-label="Main navigation">
            <button
              className={`view-tab ${section === "dashboard" ? "view-tab-active" : ""}`}
              onClick={() => setSection("dashboard")}
              aria-current={section === "dashboard" ? "page" : undefined}
            >
              <Home size={14} strokeWidth={2.4} />
              Dashboard
            </button>
            <span className="view-tabs-divider" />
            <button
              className={`view-tab ${section === "internships" ? "view-tab-active" : ""}`}
              onClick={() => setSection("internships")}
              aria-current={section === "internships" ? "page" : undefined}
            >
              <Briefcase size={14} strokeWidth={2.4} />
              Internships
            </button>
            <span className="view-tabs-divider" />
            <button
              className={`view-tab ${section === "academics" ? "view-tab-active" : ""}`}
              onClick={() => setSection("academics")}
              aria-current={section === "academics" ? "page" : undefined}
            >
              <GraduationCap size={14} strokeWidth={2.4} />
              Academics
            </button>
            <span className="view-tabs-divider" />
            <button
              className={`view-tab ${section === "scholarships" ? "view-tab-active" : ""}`}
              onClick={() => setSection("scholarships")}
              aria-current={section === "scholarships" ? "page" : undefined}
            >
              <Award size={14} strokeWidth={2.4} />
              Scholarships
            </button>
            <span className="view-tabs-divider" />
            <button
              className={`view-tab ${section === "volunteering" ? "view-tab-active" : ""}`}
              onClick={() => setSection("volunteering")}
              aria-current={section === "volunteering" ? "page" : undefined}
            >
              <HeartHandshake size={14} strokeWidth={2.4} />
              Volunteering
            </button>
            <span className="view-tabs-divider" />
            <button
              className={`view-tab ${section === "games" ? "view-tab-active" : ""}`}
              onClick={() => setSection("games")}
              aria-current={section === "games" ? "page" : undefined}
            >
              <Gamepad2 size={14} strokeWidth={2.4} />
              Games
            </button>
            <span className="view-tabs-divider" />
            <button
              className={`view-tab ${section === "settings" ? "view-tab-active" : ""}`}
              onClick={() => setSection("settings")}
              aria-current={section === "settings" ? "page" : undefined}
            >
              <Settings size={14} strokeWidth={2.4} />
              Settings
            </button>
          </nav>
        </div>
      </header>

      {section === "internships" && (
        <div className="subnav">
          <h1 className="sr-only">Internships</h1>
          <div className="subnav-tabs">
            <button
              className={`subnav-tab ${view === "board" ? "subnav-tab-active" : ""}`}
              onClick={() => setView("board")}
            >
              <LayoutGrid size={13} strokeWidth={2.4} />
              Dashboard
            </button>
            <button
              className={`subnav-tab ${view === "interviews" ? "subnav-tab-active" : ""}`}
              onClick={() => setView("interviews")}
            >
              <Video size={13} strokeWidth={2.4} />
              Interviews
            </button>
            <button
              className={`subnav-tab ${view === "stats" ? "subnav-tab-active" : ""}`}
              onClick={() => setView("stats")}
            >
              <BarChart3 size={13} strokeWidth={2.4} />
              Stats
            </button>
          </div>
          <div className="subnav-actions">
            <button className="btn btn-quick" onClick={openQuickSave} title="Just jot down a company and link, fill in the rest later">
              <Zap size={15} strokeWidth={2.4} />
              Quick save
            </button>
            <button className="btn btn-primary" onClick={() => openAdd()}>
              <Plus size={16} strokeWidth={2.5} />
              Add internship
            </button>
          </div>
        </div>
      )}

      <main className="content" id="main-content" tabIndex={-1}>
        <div className="content-inner" key={`${section}-${section === "internships" ? view : ""}`}>
        {saveError && (
          <div className="save-banner">
            Couldn't save your last change. Check your connection and try again.
          </div>
        )}
        {loading ? (
          <div className="loading-state">
            <Loader2 className="spin" size={22} />
            <span>Loading your applications…</span>
          </div>
        ) : section === "dashboard" ? (
          <DashboardPage
            account={account}
            apps={apps}
            semesters={semesters}
            gpaSettings={gpaSettings}
            scholarships={scholarships}
            onNavigate={setSection}
          />
        ) : section === "settings" ? (
          <SettingsPage
            logoId={logoId}
            onChangeLogo={changeLogo}
            account={account}
            onUpdateAccount={updateAccount}
            onSignOut={signOut}
            onDeleteAccount={deleteAccount}
            gpaSettings={gpaSettings}
            onUpdateGpaSettings={persistGpaSettings}
            showAllFilter={showAllFilter}
            onSetShowAllFilter={setShowAllFilter}
          />
        ) : section === "academics" ? (
          <AcademicsPage
            semesters={semesters}
            settings={gpaSettings}
            loading={gpaLoading}
            onPersist={persistSemesters}
            onPersistSettings={persistGpaSettings}
            onSyncProfile={syncGpaToProfile}
            currentProfileGpa={account?.profile?.gpa}
          />
        ) : section === "scholarships" ? (
          <ScholarshipsPage
            scholarships={scholarships}
            loading={scholarshipsLoading}
            onPersist={persistScholarships}
            showAllFilter={showAllFilter}
          />
        ) : section === "volunteering" ? (
          <VolunteerPage
            volunteering={volunteering}
            loading={volunteeringLoading}
            onPersist={persistVolunteering}
            showAllFilter={showAllFilter}
          />
        ) : section === "games" ? (
          <GamesPage
            favorites={favoriteGames}
            onToggleFavorite={toggleFavoriteGame}
            major={account?.profile?.major}
          />
        ) : view === "stats" ? (
          <StatsPage apps={apps} />
        ) : view === "interviews" ? (
          <InterviewsPage apps={apps} onEditApp={openEdit} />
        ) : (
          <>
            <div className="stats-row">
              <StatCard label="Total tracked" value={stats.total} icon={<Briefcase size={16} />} />
              <StatCard label="Active applications" value={stats.active} icon={<Clock size={16} />} accent="#3DA5FF" />
              <StatCard label="Offers in hand" value={stats.offers} icon={<Star size={16} />} accent="#2FBF71" />
              <StatCard label="Deadlines within 14 days" value={stats.soon} icon={<Calendar size={16} />} accent="#FF5C5C" />
            </div>

            <div className="controls-row">
              <div className="search-box">
                <Search size={15} strokeWidth={2.2} aria-hidden="true" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by company, role, or location"
                  aria-label="Search internships by company, role, or location"
                />
              </div>

              <div className="chip-filters" role="group" aria-label="Filter internships by status">
                {(showAllFilter ? ["All", ...STATUSES] : STATUSES).map((s) => (
                  <button
                    key={s}
                    className={`filter-chip ${filter === s ? "filter-chip-active" : ""}`}
                    onClick={() => setFilter(s)}
                    aria-pressed={filter === s}
                  >
                    {s !== "All" && (
                      <span className="chip-dot" style={{ background: STATUS_META[s].dot }} />
                    )}
                    {s}
                  </button>
                ))}
              </div>

              <div className="sort-box">
                <ArrowUpDown size={13} strokeWidth={2.2} aria-hidden="true" />
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Sort internships by">
                  <option value="deadline">Deadline</option>
                  <option value="company">Company</option>
                  <option value="applied">Recently applied</option>
                </select>
              </div>
            </div>

            {filter === "All" ? (
              <div className="board">
                {STATUSES.map((status) => (
                  <div className="column" key={status}>
                    <div className="column-head">
                      <span className="chip-dot" style={{ background: STATUS_META[status].dot }} />
                      <h3>{status}</h3>
                      <span className="column-count">{byStatus[status].length}</span>
                    </div>
                    <div className="column-body">
                      {byStatus[status].length === 0 ? (
                        <button className="empty-slot" onClick={() => openAdd(status)}>
                          <Plus size={14} />
                          Add one
                        </button>
                      ) : (
                        byStatus[status].map((item) => (
                          <Card
                            key={item.id}
                            item={item}
                            onEdit={() => openEdit(item)}
                            onDelete={() => setConfirmDelete(item.id)}
                            onStatusChange={(s) => changeStatus(item.id, s)}
                            onQuickView={() => openQuickView(item)}
                          />
                        ))
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="list-view">
                {filtered.length === 0 ? (
                  <div className="empty-state">
                    <Sparkles size={22} />
                    <p>Nothing here yet.</p>
                    <button className="btn btn-secondary" onClick={() => openAdd(filter === "All" ? undefined : filter)}>
                      Add an internship
                    </button>
                  </div>
                ) : (
                  filtered.map((item) => (
                    <Card
                      key={item.id}
                      item={item}
                      wide
                      onEdit={() => openEdit(item)}
                      onDelete={() => setConfirmDelete(item.id)}
                      onStatusChange={(s) => changeStatus(item.id, s)}
                      onQuickView={() => openQuickView(item)}
                    />
                  ))
                )}
              </div>
            )}
          </>
        )}
        </div>
      </main>

      {modalOpen && (
        <EditModal
          draft={draft}
          setDraft={setDraft}
          onCancel={closeModal}
          onSave={saveDraft}
        />
      )}

      {quickViewItem && (
        <QuickViewModal
          item={quickViewItem}
          onClose={closeQuickView}
          onEdit={() => { closeQuickView(); openEdit(quickViewItem); }}
          onStatusChange={(s) => changeStatus(quickViewItem.id, s)}
        />
      )}

      {quickSaveOpen && (
        <QuickSaveModal
          draft={quickSaveDraft}
          setDraft={setQuickSaveDraft}
          onCancel={closeQuickSave}
          onSave={saveQuickAdd}
          onSaveAndEdit={saveQuickAddAndEdit}
        />
      )}

      {confirmDelete && (
        <div className="overlay" onClick={() => setConfirmDelete(null)} onKeyDown={(e) => { if (e.key === "Escape") setConfirmDelete(null); }}>
          <div className="confirm-box" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true" aria-label="Remove this internship from your tracker?">
            <p>Remove this internship from your tracker?</p>
            <div className="confirm-actions">
              <button className="btn btn-ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => removeApp(confirmDelete)}>Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch() {
    // fallback UI below handles this - nothing else to do
  }
  handleRetry = () => {
    this.setState({ hasError: false });
  };
  render() {
    if (this.state.hasError) {
      return <ErrorPage onRetry={this.handleRetry} />;
    }
    return this.props.children;
  }
}

function ErrorPage({ onRetry }) {
  const reportIssue = () => {
    const subject = encodeURIComponent("Internly crash report");
    const body = encodeURIComponent(
      "The app hit an unexpected error and showed the fallback screen.\n\nWhat I was doing when it happened:\n"
    );
    window.location.href = `mailto:gileskamani@gmail.com?subject=${subject}&body=${body}`;
  };

  return (
    <div className="internly-root">
      <style>{CSS}</style>
      <div className="auth-stage">
        <div className="auth-card">
          <div className="auth-brand">
            <Logo size={44} />
            <span className="auth-brand-name">internly</span>
          </div>
          <span className="error-code">404</span>
          <h2 className="auth-title">Something broke</h2>
          <p className="auth-sub">
            This part of Internly hit a snag. Your saved data is safe. Try again, or let us know what happened.
          </p>
          <div className="auth-actions-row">
            <button className="btn btn-primary" onClick={onRetry}>
              <RotateCcw size={14} />
              Try again
            </button>
            <button className="btn btn-ghost" onClick={reportIssue}>
              <Bug size={13} />
              Report this issue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Internly() {
  return (
    <ErrorBoundary>
      <InternlyApp />
    </ErrorBoundary>
  );
}

// Warm palette generator - interpolates across the logo's pink → coral → gold gradient
const THEME_STOPS = [
  [232, 93, 132],  // pink
  [234, 107, 84],  // coral
  [245, 188, 109], // gold
];

function warmPalette(n) {
  if (n <= 1) return ["#EA6B54"];
  const segments = THEME_STOPS.length - 1;
  const colors = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * segments;
    const seg = Math.min(Math.floor(t), segments - 1);
    const localT = t - seg;
    const [r1, g1, b1] = THEME_STOPS[seg];
    const [r2, g2, b2] = THEME_STOPS[seg + 1];
    const r = Math.round(r1 + (r2 - r1) * localT);
    const g = Math.round(g1 + (g2 - g1) * localT);
    const b = Math.round(b1 + (b2 - b1) * localT);
    colors.push(`rgb(${r}, ${g}, ${b})`);
  }
  return colors;
}

function ChartCard({ title, subtitle, children, isEmpty, emptyText, full }) {
  return (
    <div className={`chart-card ${full ? "chart-card-full" : ""}`}>
      <div className="chart-card-head">
        <h3>{title}</h3>
        {subtitle && <span className="chart-card-sub">{subtitle}</span>}
      </div>
      {isEmpty ? (
        <div className="chart-empty">
          <Inbox size={18} />
          <span>{emptyText || "No data yet"}</span>
        </div>
      ) : (
        children
      )}
    </div>
  );
}

function StatsTooltip({ active, payload, label, unit, prefix }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{payload[0].payload.fullLabel || label}</div>
      <div className="chart-tooltip-value">
        {prefix || ""}{payload[0].value.toLocaleString()}{unit || ""}
      </div>
    </div>
  );
}

function StatsPage({ apps }) {
  const list = apps || [];

  const statusColors = useMemo(() => warmPalette(STATUSES.length), []);
  const statusData = useMemo(
    () =>
      STATUSES.map((s, i) => ({
        name: STATUS_META[s].label,
        value: list.filter((a) => a.status === s).length,
        color: statusColors[i],
      })),
    [list, statusColors]
  );
  const statusHasData = statusData.some((d) => d.value > 0);

  const workTypeColors = useMemo(() => warmPalette(WORK_TYPES.length), []);
  const workTypeData = useMemo(
    () =>
      WORK_TYPES.map((w, i) => ({
        name: w,
        value: list.filter((a) => a.workType === w).length,
        color: workTypeColors[i],
      })),
    [list, workTypeColors]
  );
  const workTypeHasData = workTypeData.some((d) => d.value > 0);

  const interestColors = useMemo(() => warmPalette(INTEREST_LEVELS.length), []);
  const interestData = useMemo(
    () =>
      INTEREST_LEVELS.map((lvl, i) => ({
        name: lvl,
        value: list.filter((a) => a.interest === lvl).length,
        color: interestColors[i],
      })),
    [list, interestColors]
  );
  const interestHasData = interestData.some((d) => d.value > 0);

  const rateData = useMemo(() => {
    return list
      .filter((a) => a.hourlyRate && !isNaN(parseFloat(a.hourlyRate)))
      .map((a) => ({
        name: a.company.length > 12 ? a.company.slice(0, 11) + "…" : a.company,
        fullLabel: a.jobTitle ? `${a.company} · ${a.jobTitle}` : a.company,
        value: parseFloat(a.hourlyRate),
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [list]);

  const salaryData = useMemo(() => {
    return list
      .map((a) => {
        const match = (a.salary || "").match(/[\d,]+(\.\d+)?/);
        if (!match) return null;
        const value = parseFloat(match[0].replace(/,/g, ""));
        if (isNaN(value) || value <= 0) return null;
        return {
          name: a.company.length > 12 ? a.company.slice(0, 11) + "…" : a.company,
          fullLabel: a.jobTitle ? `${a.company} · ${a.jobTitle}` : a.company,
          value,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [list]);

  const rateColors = useMemo(() => warmPalette(Math.max(rateData.length, 1)), [rateData.length]);
  const salaryColors = useMemo(() => warmPalette(Math.max(salaryData.length, 1)), [salaryData.length]);

  if (list.length === 0) {
    return (
      <div className="empty-state">
        <Sparkles size={22} />
        <p>Add a few internships to see your stats.</p>
      </div>
    );
  }

  return (
    <div className="stats-page">
      <div className="stats-grid">
        <ChartCard title="Applications by status" subtitle="Where things stand right now" isEmpty={!statusHasData}>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={statusData.filter((d) => d.value > 0)}
                dataKey="value"
                nameKey="name"
                outerRadius={80}
                paddingAngle={2}
              >
                {statusData.filter((d) => d.value > 0).map((d, i) => (
                  <Cell key={i} fill={d.color} stroke="#fff" strokeWidth={2} />
                ))}
              </Pie>
              <Tooltip content={<StatsTooltip />} />
              <Legend
                verticalAlign="bottom"
                iconType="circle"
                iconSize={8}
                formatter={(value, entry) => (
                  <span className="legend-label">{value} ({entry.payload.value})</span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Work type" subtitle="Remote, hybrid, or in-person" isEmpty={!workTypeHasData}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={workTypeData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F2E4DD" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#7A6470" }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#7A6470" }} axisLine={false} tickLine={false} />
              <Tooltip content={<StatsTooltip />} cursor={{ fill: "#FFF1E9" }} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {workTypeData.map((d, i) => (
                  <Cell key={i} fill={d.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Interest level" subtitle="How excited you are about each one" isEmpty={!interestHasData}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={interestData} layout="vertical" margin={{ top: 8, right: 16, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#F2E4DD" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "#7A6470" }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11.5, fill: "#3A2432", fontWeight: 600 }} axisLine={false} tickLine={false} width={64} />
              <Tooltip content={<StatsTooltip />} cursor={{ fill: "#FFF1E9" }} />
              <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                {interestData.map((d, i) => (
                  <Cell key={i} fill={d.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Hourly rate by company"
          subtitle="Top 10, highest first"
          isEmpty={rateData.length === 0}
          emptyText="Add an hourly rate to a listing to see this chart"
        >
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={rateData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F2E4DD" />
              <XAxis dataKey="name" tick={{ fontSize: 10.5, fill: "#7A6470" }} axisLine={false} tickLine={false} interval={0} angle={-20} textAnchor="end" height={46} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#7A6470" }} axisLine={false} tickLine={false} />
              <Tooltip content={<StatsTooltip unit="/hr" />} cursor={{ fill: "#FFF1E9" }} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]} fill="var(--coral)">
                {rateData.map((_, i) => (
                  <Cell key={i} fill={rateColors[i]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Salary by company"
          subtitle="Top 10, highest first · non-hourly listings"
          isEmpty={salaryData.length === 0}
          emptyText="Add a salary to a listing to see this chart"
          full
        >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={salaryData} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F2E4DD" />
              <XAxis dataKey="name" tick={{ fontSize: 10.5, fill: "#7A6470" }} axisLine={false} tickLine={false} interval={0} angle={-20} textAnchor="end" height={46} />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: "#7A6470" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : v}`}
              />
              <Tooltip content={<StatsTooltip unit="" prefix="$" />} cursor={{ fill: "#FFF1E9" }} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {salaryData.map((_, i) => (
                  <Cell key={i} fill={salaryColors[i]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}

function SemesterCard({ semester, index, threshold, grades, gradePoints, defaultExpanded, onChange, onRemove }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [expanded, setExpanded] = useState(defaultExpanded !== false);
  const [quickView, setQuickView] = useState(false);
  const stats = semesterGpa(semester, gradePoints);
  const isDeansList = stats.actualCredits > 0 && stats.actualGpa >= parseFloat(threshold || 3.5);

  const addCourse = () => {
    onChange({ ...semester, courses: [...semester.courses, emptyCourse()] });
  };
  const updateCourse = (id, patch) => {
    onChange({ ...semester, courses: semester.courses.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  };
  const removeCourse = (id) => {
    onChange({ ...semester, courses: semester.courses.filter((c) => c.id !== id) });
  };

  return (
    <div className="semester-card">
      <div className="semester-head">
        <button className="semester-head-toggle" onClick={() => setExpanded((v) => !v)}>
          <ChevronDown size={15} className={`collapsible-chevron ${expanded ? "collapsible-chevron-open" : ""}`} />
          <div className="semester-head-left">
            <span className="semester-name">{semester.name || `Semester ${index + 1}`}</span>
            <span className="semester-gpa-badge">
              {stats.actualGpa === null ? "No grades yet" : `${stats.actualGpa.toFixed(2)} actual`}
            </span>
            {stats.goalGpa !== null && (
              <span className="semester-gpa-badge semester-gpa-badge-goal">
                {stats.goalGpa.toFixed(2)} goal
              </span>
            )}
            {stats.actualCredits > 0 && <span className="semester-credits">{stats.actualCredits} credits</span>}
            {semester.courses.length > 0 && (
              <span className="semester-credits">{semester.courses.length} course{semester.courses.length === 1 ? "" : "s"}</span>
            )}
            {isDeansList && <span className="deans-list-badge">🏅 Dean's List</span>}
          </div>
        </button>
        <div className="semester-head-actions">
          {confirmDelete ? (
            <div className="semester-delete-confirm">
              <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={onRemove}>Remove</button>
            </div>
          ) : (
            <>
              <button className="icon-btn" onClick={() => setQuickView(true)} aria-label="Quick view" title="Quick view">
                <Eye size={14} />
              </button>
              <button className="icon-btn" onClick={() => setConfirmDelete(true)} aria-label="Remove semester" title="Remove semester">
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      {expanded && (
        <>
          {semester.courses.length > 0 && (
            <div className="course-table">
              <div className="course-row course-row-head">
                <span>Course ID</span>
                <span>Course name</span>
                <span>Credits</span>
                <span>Category</span>
                <span>Goal</span>
                <span>Actual</span>
                <span></span>
              </div>
              {semester.courses.map((c) => (
                <div className="course-row" key={c.id}>
                  <input
                    value={c.courseId}
                    onChange={(e) => updateCourse(c.id, { courseId: e.target.value })}
                    placeholder="ACCT201"
                  />
                  <input
                    value={c.name}
                    onChange={(e) => updateCourse(c.id, { name: e.target.value })}
                    placeholder="Course name"
                  />
                  <input
                    value={c.credits}
                    onChange={(e) => updateCourse(c.id, { credits: e.target.value })}
                    placeholder="3"
                    inputMode="decimal"
                  />
                  <select value={c.category} onChange={(e) => updateCourse(c.id, { category: e.target.value })}>
                    {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                  <select value={c.goalGrade} onChange={(e) => updateCourse(c.id, { goalGrade: e.target.value })}>
                    {grades.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                  <select value={c.actualGrade} onChange={(e) => updateCourse(c.id, { actualGrade: e.target.value })}>
                    <option value="">-</option>
                    {grades.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                  <button className="icon-btn" onClick={() => removeCourse(c.id)} aria-label="Remove course" title="Remove course">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <button className="course-add-trigger" onClick={addCourse}>
            <Plus size={12} />
            Add course
          </button>
        </>
      )}

      {quickView && (
        <SemesterQuickView
          semester={semester}
          index={index}
          stats={stats}
          isDeansList={isDeansList}
          onClose={() => setQuickView(false)}
        />
      )}
    </div>
  );
}

function SemesterQuickView({ semester, index, stats, isDeansList, onClose }) {
  return (
    <div className="overlay" onClick={onClose} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div className="qv-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="qv-semester-title">
        <div className="qv-head">
          <div>
            <h2 id="qv-semester-title" className="qv-company">{semester.name || `Semester ${index + 1}`}</h2>
            <div className="qv-role">
              {stats.actualGpa === null ? "No grades yet" : `${stats.actualGpa.toFixed(2)} actual GPA`}
              {stats.goalGpa !== null ? ` · ${stats.goalGpa.toFixed(2)} goal GPA` : ""}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        <div className="qv-body">
          <div className="qv-chips">
            {stats.actualCredits > 0 && <span className="chip chip-ok">{stats.actualCredits} credits</span>}
            {isDeansList && <span className="deans-list-badge">🏅 Dean's List</span>}
          </div>

          <div className="qv-section">
            <span className="qv-section-title">Courses</span>
            {semester.courses.length === 0 ? (
              <span className="empty-hint">No courses added to this semester yet.</span>
            ) : (
              semester.courses.map((c) => (
                <div className="qv-course-row" key={c.id}>
                  <span className="qv-course-name">{c.name || c.courseId || "Untitled course"}</span>
                  <span className="qv-course-meta">{c.credits || "N/A"} cr · {c.category}</span>
                  <span className="qv-course-grade">
                    {c.actualGrade ? c.actualGrade : `Goal: ${c.goalGrade}`}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function ToggleSwitch({ checked, onChange, label, description }) {
  const labelId = useId();
  const descId = useId();
  return (
    <div className="toggle-row">
      <div className="toggle-row-text">
        <span className="toggle-label" id={labelId}>{label}</span>
        {description && <span className="toggle-desc" id={descId}>{description}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={description ? descId : undefined}
        className={`toggle-switch ${checked ? "toggle-switch-on" : ""}`}
        onClick={onChange}
      >
        <span className="toggle-knob" />
      </button>
    </div>
  );
}

function GradeScaleEditor({ gradeScale, onSave }) {
  const [draft, setDraft] = useState(gradeScale);
  const [saved, setSaved] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => { setDraft(gradeScale); }, [gradeScale]);

  const updateRow = (i, patch) => {
    setDraft(draft.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
    setSaved(false);
  };
  const removeRow = (i) => {
    setDraft(draft.filter((_, idx) => idx !== i));
    setSaved(false);
  };
  const addRow = () => {
    setDraft([...draft, { grade: "", points: "" }]);
    setSaved(false);
  };
  const resetDefault = () => {
    setDraft(DEFAULT_GRADE_SCALE.map((g) => ({ ...g })));
    setSaved(false);
  };
  const save = () => {
    onSave(draft.filter((r) => r.grade.trim()));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="settings-section">
      <button className="collapsible-head" onClick={() => setExpanded((v) => !v)}>
        <div className="collapsible-head-text">
          <h3 className="settings-title">Grade scale</h3>
          <p className="settings-sub">
            {draft.length} grade{draft.length === 1 ? "" : "s"} configured, used for every GPA calculation across Academics.
          </p>
        </div>
        <ChevronDown size={16} className={`collapsible-chevron ${expanded ? "collapsible-chevron-open" : ""}`} />
      </button>

      {expanded && (
        <>
          <p className="settings-sub">
            Not every school weighs letter grades the same way, so set your own grade-to-GPA-point values here.
          </p>
          <div className="grade-scale-table">
            <div className="grade-scale-row grade-scale-row-head">
              <span>Grade</span>
              <span>GPA points</span>
              <span></span>
            </div>
            {draft.map((row, i) => (
              <div className="grade-scale-row" key={i}>
                <input
                  value={row.grade}
                  onChange={(e) => {
                    const cleaned = e.target.value.replace(/[^A-Za-z+\-]/g, "").toUpperCase();
                    updateRow(i, { grade: cleaned });
                  }}
                  placeholder="A+"
                />
                <input
                  value={row.points}
                  onChange={(e) => {
                    let v = e.target.value.replace(/[^0-9.]/g, "");
                    const n = parseFloat(v);
                    if (!isNaN(n) && n > 4.0) v = "4.0";
                    updateRow(i, { points: v });
                  }}
                  placeholder="4.0"
                  inputMode="decimal"
                />
                <button className="icon-btn" onClick={() => removeRow(i)} aria-label="Remove grade" title="Remove grade">
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
          <div className="grade-scale-actions">
            <button className="course-add-trigger" onClick={addRow}>
              <Plus size={12} />
              Add grade
            </button>
          </div>
          <div className="settings-actions">
            <button className="btn btn-ghost" onClick={resetDefault}>Reset to standard 4.0 scale</button>
            <button className="btn btn-primary" onClick={save}>
              {saved ? <Check size={14} /> : null}
              {saved ? "Saved" : "Save grade scale"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function AcademicsPage({ semesters, settings, loading, onPersist, onPersistSettings, onSyncProfile, currentProfileGpa }) {
  const [addingSemester, setAddingSemester] = useState(false);
  const [newSemesterName, setNewSemesterName] = useState("");
  const [settingsDraft, setSettingsDraft] = useState(settings);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [whatIfTarget, setWhatIfTarget] = useState("3.7");
  const [whatIfCredits, setWhatIfCredits] = useState("15");
  const [gradConfigExpanded, setGradConfigExpanded] = useState(false);

  useEffect(() => { setSettingsDraft(settings); }, [settings]);

  if (loading) {
    return (
      <div className="loading-state">
        <Loader2 className="spin" size={22} />
        <span>Loading your academics…</span>
      </div>
    );
  }

  const list = semesters || [];
  const gradeScale = settings.gradeScale && settings.gradeScale.length ? settings.gradeScale : DEFAULT_GRADE_SCALE;
  const gradePoints = scaleToPoints(gradeScale);
  const grades = scaleGrades(gradeScale);
  const cumulative = cumulativeGpa(list, gradePoints);
  const cumulativeStr = cumulative.gpa === null ? null : cumulative.gpa.toFixed(2);
  const threshold = parseFloat(settings.deansListThreshold) || 3.5;
  const degreeCredits = parseFloat(settings.degreeCredits) || 0;
  const pctComplete = degreeCredits > 0 ? Math.min(100, (cumulative.credits / degreeCredits) * 100) : 0;

  const completedSemesters = list.filter((s) => semesterGpa(s, gradePoints).actualCredits > 0).length;
  const deansListCount = list.filter((s) => {
    const st = semesterGpa(s, gradePoints);
    return st.actualCredits > 0 && st.actualGpa >= threshold;
  }).length;

  const chartData = list.map((s, i) => {
    const cum = cumulativeGpa(list.slice(0, i + 1), gradePoints);
    return {
      name: s.name || `Sem ${i + 1}`,
      value: cum.gpa === null ? null : Number(cum.gpa.toFixed(3)),
    };
  }).filter((d) => d.value !== null);

  const gradeCounts = grades.map((g) => {
    let goal = 0, actual = 0;
    list.forEach((s) => (s.courses || []).forEach((c) => {
      if (c.goalGrade === g) goal += 1;
      if (c.actualGrade === g) actual += 1;
    }));
    return { name: g, Goal: goal, Actual: actual };
  }).filter((d) => d.Goal > 0 || d.Actual > 0);

  const neededGpa = gpaNeeded(whatIfTarget, cumulative.credits, cumulative.gpa || 0, whatIfCredits);

  const addSemester = () => {
    if (!newSemesterName.trim()) return;
    onPersist([...list, { ...emptySemester(), name: newSemesterName.trim() }]);
    setNewSemesterName("");
    setAddingSemester(false);
  };
  const updateSemester = (id, next) => onPersist(list.map((s) => (s.id === id ? next : s)));
  const removeSemester = (id) => onPersist(list.filter((s) => s.id !== id));

  const saveSettings = () => {
    onPersistSettings(settingsDraft);
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 2000);
  };

  const saveGradeScale = (nextScale) => {
    onPersistSettings({ ...settings, gradeScale: nextScale });
  };

  const showGradeChart = settings.showGradeDistribution && gradeCounts.length > 0;
  const showCumulativeChart = settings.showCumulativeChart && chartData.length > 0;

  const creditsToGradCard = (
    <div className="settings-section">
      <h3 className="settings-title">Credits to graduation</h3>
      <div className="grad-progress">
        <div className="grad-progress-track">
          <div className="grad-progress-fill" style={{ width: `${pctComplete}%` }} />
        </div>
        <span className="grad-progress-label">
          {cumulative.credits} of {degreeCredits || "N/A"} credits ({pctComplete.toFixed(0)}%)
        </span>
      </div>

      <button className="collapsible-head grad-config-toggle" onClick={() => setGradConfigExpanded((v) => !v)}>
        <div className="collapsible-head-text">
          <span className="settings-sub grad-config-label">Requirement & Dean's List threshold</span>
        </div>
        <ChevronDown size={15} className={`collapsible-chevron ${gradConfigExpanded ? "collapsible-chevron-open" : ""}`} />
      </button>

      {gradConfigExpanded && (
        <>
          <div className="field-row">
            <label>
              Degree requirement (credits)
              <input
                value={settingsDraft.degreeCredits}
                onChange={(e) => setSettingsDraft({ ...settingsDraft, degreeCredits: e.target.value })}
                inputMode="numeric"
              />
            </label>
            <label>
              Dean's List GPA threshold
              <input
                value={settingsDraft.deansListThreshold}
                onChange={(e) => setSettingsDraft({ ...settingsDraft, deansListThreshold: e.target.value })}
                inputMode="decimal"
              />
            </label>
          </div>
          <div className="settings-actions">
            <button className="btn btn-primary" onClick={saveSettings}>
              {settingsSaved ? <Check size={14} /> : null}
              {settingsSaved ? "Saved" : "Save settings"}
            </button>
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="academics-page">
      <h1 className="sr-only">Academics</h1>
      <div className="stats-row academics-stats-row-4">
        <StatCard label="Overall GPA" value={cumulativeStr === null ? "N/A" : cumulativeStr} icon={<GraduationCap size={16} />} />
        <StatCard label="Completed credits" value={cumulative.credits} icon={<Briefcase size={16} />} accent="#3DA5FF" />
        <StatCard label="Completed semesters" value={completedSemesters} icon={<Calendar size={16} />} accent="#2FBF71" />
        <StatCard label="Dean's List semesters" value={deansListCount} icon={<Star size={16} />} accent="#FFC857" />
      </div>

      {cumulativeStr !== null && (
        <div className="gpa-sync-banner">
          <span>
            {currentProfileGpa
              ? `Your profile GPA is currently ${currentProfileGpa}.`
              : "Your profile doesn't have a GPA set yet."}
          </span>
          <button className="btn btn-secondary" onClick={() => onSyncProfile(cumulativeStr)}>
            <Check size={13} />
            Use {cumulativeStr} as my profile GPA
          </button>
        </div>
      )}

      {settings.showWhatIfCalculator ? (
        <div className="academics-grid">
          {creditsToGradCard}
          <div className="settings-section">
            <h3 className="settings-title">What-if grade calculator</h3>
            <p className="settings-sub">See what GPA you'd need next semester to hit a target cumulative GPA.</p>
            <div className="field-row">
              <label>
                Target cumulative GPA
                <input value={whatIfTarget} onChange={(e) => setWhatIfTarget(e.target.value)} inputMode="decimal" />
              </label>
              <label>
                Planned credits next semester
                <input value={whatIfCredits} onChange={(e) => setWhatIfCredits(e.target.value)} inputMode="numeric" />
              </label>
            </div>
            <div className="whatif-result">
              {neededGpa === null ? (
                <span className="empty-hint">Enter a target GPA and planned credits.</span>
              ) : neededGpa > 4.0 ? (
                <span className="whatif-value whatif-value-hard">Not possible, even a 4.0 wouldn't reach {whatIfTarget}.</span>
              ) : neededGpa < 0 ? (
                <span className="whatif-value whatif-value-easy">Already on track, you'll clear {whatIfTarget} regardless.</span>
              ) : (
                <span className="whatif-value">You'll need at least <strong>{neededGpa.toFixed(2)}</strong> next semester.</span>
              )}
            </div>
          </div>
        </div>
      ) : (
        creditsToGradCard
      )}

      {settings.showCategoryBreakdown && CATEGORIES.some((cat) => cumulative.byCategory[cat]) && (
        <div className="settings-section">
          <h3 className="settings-title">Credits by category</h3>
          <div className="category-table">
            <div className="category-row category-row-head">
              <span>Category</span>
              <span>Planned</span>
              <span>Completed</span>
            </div>
            {CATEGORIES.map((cat) => {
              const v = cumulative.byCategory[cat] || { planned: 0, completed: 0 };
              return (
                <div className="category-row" key={cat}>
                  <span>{cat}</span>
                  <span>{v.planned}</span>
                  <span>{v.completed}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <GradeScaleEditor gradeScale={gradeScale} onSave={saveGradeScale} />

      {(showCumulativeChart || showGradeChart) && (
        <div className="stats-grid">
          {showCumulativeChart && (
            <ChartCard title="Cumulative GPA by semester" subtitle="Actual GPA, running total">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F2E4DD" />
                  <XAxis dataKey="name" tick={{ fontSize: 10.5, fill: "#7A6470" }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 4]} tick={{ fontSize: 11, fill: "#7A6470" }} axisLine={false} tickLine={false} />
                  <Tooltip content={<StatsTooltip />} />
                  <Line type="monotone" dataKey="value" stroke="var(--coral)" strokeWidth={2.5} dot={{ r: 4, fill: "var(--coral)" }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          )}

          {showGradeChart && (
            <ChartCard title="Grade distribution" subtitle="Goal vs. actual, by letter grade">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={gradeCounts} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F2E4DD" />
                  <XAxis dataKey="name" tick={{ fontSize: 10.5, fill: "#7A6470" }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#7A6470" }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: "#FFF1E9" }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11.5 }} />
                  <Bar dataKey="Goal" fill="var(--peach)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Actual" fill="var(--coral)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
        </div>
      )}

      <div className="semesters-list">
        {list.length === 0 && !addingSemester && (
          <div className="empty-state">
            <GraduationCap size={22} />
            <p>No semesters added yet.</p>
            <span className="empty-hint">Add a semester to start tracking your GPA.</span>
          </div>
        )}

        {list.map((s, i) => (
          <SemesterCard
            key={s.id}
            semester={s}
            index={i}
            threshold={settings.deansListThreshold}
            grades={grades}
            gradePoints={gradePoints}
            defaultExpanded={false}
            onChange={(next) => updateSemester(s.id, next)}
            onRemove={() => removeSemester(s.id)}
          />
        ))}

        {addingSemester ? (
          <div className="semester-add-form">
            <input
              value={newSemesterName}
              onChange={(e) => setNewSemesterName(e.target.value)}
              placeholder="e.g. Fall 2026"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && addSemester()}
            />
            <div className="semester-add-actions">
              <button className="btn btn-ghost" onClick={() => { setAddingSemester(false); setNewSemesterName(""); }}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={addSemester} disabled={!newSemesterName.trim()}>
                Add semester
              </button>
            </div>
          </div>
        ) : (
          <button className="empty-slot academics-add-semester" onClick={() => setAddingSemester(true)}>
            <Plus size={14} />
            Add semester
          </button>
        )}
      </div>
    </div>
  );
}

function formatMoney(v) {
  const n = parseFloat((v || "").toString().replace(/[^0-9.-]/g, ""));
  if (isNaN(n)) return null;
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function ScholarshipCard({ item, onEdit, onDelete, onStatusChange, onQuickView }) {
  const [statusOpen, setStatusOpen] = useState(false);
  const amount = formatMoney(item.amount);

  return (
    <div className="card" onClick={onQuickView} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onQuickView(); } }} role="button" tabIndex={0}>
      <div className="card-top">
        <div className="card-title">
          <span className="card-company">{item.name || "Untitled scholarship"}</span>
          <span className="card-role">{item.sponsor || "Sponsor not set"}</span>
        </div>
        <div className="card-actions">
          <button className="icon-btn" onClick={(e) => { e.stopPropagation(); onQuickView(); }} aria-label="Quick view" title="Quick view">
            <Eye size={13} />
          </button>
          <button className="icon-btn" onClick={(e) => { e.stopPropagation(); onEdit(); }} aria-label="Edit" title="Edit">
            <Pencil size={13} />
          </button>
          <button className="icon-btn" onClick={(e) => { e.stopPropagation(); onDelete(); }} aria-label="Remove" title="Remove">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <div className="card-meta">
        {amount && <span className="meta-item"><DollarSign size={12} />{amount}</span>}
        {item.renewable === "Yes" && <span className="meta-item"><Repeat size={12} />Renewable</span>}
        {item.essayRequired === "Yes" && <span className="meta-item"><FileText size={12} />Essay required</span>}
      </div>

      <div className="card-bottom">
        <DeadlineChip deadline={item.deadline} />
        {item.link && (
          <a
            className="link-btn"
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            title="Open listing"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink size={12} />
          </a>
        )}
      </div>

      <div className="status-select" onClick={(e) => e.stopPropagation()}>
        <button className="status-btn" onClick={() => setStatusOpen((v) => !v)}>
          <span className="chip-dot" style={{ background: SCHOLARSHIP_STATUS_META[item.status].dot }} />
          {item.status}
          <ChevronDown size={12} />
        </button>
        {statusOpen && (
          <div className="status-menu">
            {SCHOLARSHIP_STATUSES.map((s) => (
              <button
                key={s}
                className="status-menu-item"
                onClick={() => { onStatusChange(s); setStatusOpen(false); }}
              >
                <span className="chip-dot" style={{ background: SCHOLARSHIP_STATUS_META[s].dot }} />
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ScholarshipModal({ draft, setDraft, isEditing, onCancel, onSave }) {
  const set = (k) => (e) => setDraft({ ...draft, [k]: e.target.value });

  return (
    <div className="overlay" onClick={onCancel} onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="scholarship-modal-title">
        <div className="modal-head">
          <h2 id="scholarship-modal-title">{isEditing ? "Edit scholarship" : "Add scholarship"}</h2>
          <button className="icon-btn" onClick={onCancel} aria-label="Close"><X size={16} /></button>
        </div>

        <div className="modal-body">
          <div className="field-row">
            <label>
              Scholarship name <span className="req">*</span>
              <input value={draft.name} onChange={set("name")} placeholder="e.g. Dean's Merit Award" autoFocus />
            </label>
            <label>
              Sponsor / organization
              <input value={draft.sponsor} onChange={set("sponsor")} placeholder="e.g. Towson University" />
            </label>
          </div>

          <div className="field-row">
            <label>
              Amount
              <input value={draft.amount} onChange={set("amount")} placeholder="e.g. 2500" inputMode="decimal" />
            </label>
            <label>
              Deadline
              <input type="date" value={draft.deadline} onChange={set("deadline")} />
            </label>
          </div>

          <div className="field-row">
            <label>
              Status
              <select value={draft.status} onChange={set("status")}>
                {SCHOLARSHIP_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label>
              Renewable
              <select value={draft.renewable} onChange={set("renewable")}>
                <option value="No">No</option>
                <option value="Yes">Yes</option>
              </select>
            </label>
          </div>

          <div className="field-row">
            <label>
              Essay required
              <select value={draft.essayRequired} onChange={set("essayRequired")}>
                <option value="No">No</option>
                <option value="Yes">Yes</option>
              </select>
            </label>
            <label>
              Listing link
              <div className="input-with-icon">
                <Link2 size={13} />
                <input value={draft.link} onChange={set("link")} placeholder="https://..." />
              </div>
            </label>
          </div>

          <label className="field-full">
            Requirements / eligibility
            <textarea value={draft.requirements} onChange={set("requirements")} rows={2} placeholder="GPA minimum, major, essay topic…" />
          </label>

          <label className="field-full">
            Notes
            <textarea value={draft.notes} onChange={set("notes")} rows={2} placeholder="Recommenders, follow-ups…" />
          </label>
        </div>

        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={onSave} disabled={!draft.name.trim()}>
            {isEditing ? "Save changes" : "Add scholarship"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ScholarshipQuickView({ item, onClose, onEdit, onStatusChange }) {
  const amount = formatMoney(item.amount);

  return (
    <div className="overlay" onClick={onClose} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div className="qv-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="qv-scholarship-title">
        <div className="qv-head">
          <div>
            <h2 id="qv-scholarship-title" className="qv-company">{item.name || "Untitled scholarship"}</h2>
            <div className="qv-role">{item.sponsor || "Sponsor not set"}</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        <div className="qv-status-row">
          {SCHOLARSHIP_STATUSES.map((s) => (
            <button
              key={s}
              className={`qv-status-pill ${item.status === s ? "qv-status-pill-active" : ""}`}
              style={item.status === s ? { background: SCHOLARSHIP_STATUS_META[s].dot, borderColor: SCHOLARSHIP_STATUS_META[s].dot } : {}}
              onClick={() => onStatusChange(s)}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="qv-body">
          <div className="qv-grid">
            {amount && (
              <div className="qv-field">
                <span className="qv-field-label"><DollarSign size={12} />Amount</span>
                <span className="qv-field-value">{amount}</span>
              </div>
            )}
            <div className="qv-field">
              <span className="qv-field-label"><Repeat size={12} />Renewable</span>
              <span className="qv-field-value">{item.renewable || "No"}</span>
            </div>
            <div className="qv-field">
              <span className="qv-field-label"><FileText size={12} />Essay required</span>
              <span className="qv-field-value">{item.essayRequired || "No"}</span>
            </div>
          </div>

          <div className="qv-chips">
            <DeadlineChip deadline={item.deadline} />
          </div>

          {item.requirements && (
            <div className="qv-section">
              <span className="qv-section-title">Requirements / eligibility</span>
              <p className="qv-notes">{item.requirements}</p>
            </div>
          )}

          {item.notes && (
            <div className="qv-section">
              <span className="qv-section-title"><StickyNote size={12} />Notes</span>
              <p className="qv-notes">{item.notes}</p>
            </div>
          )}
        </div>

        <div className="modal-foot">
          {item.link && (
            <a className="btn btn-ghost" href={item.link} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={13} />
              Open listing
            </a>
          )}
          <button className="btn btn-primary" onClick={onEdit}>
            <Pencil size={13} />
            Edit
          </button>
        </div>
      </div>
    </div>
  );
}

function ScholarshipsPage({ scholarships, loading, onPersist, showAllFilter }) {
  const [filter, setFilter] = useState("All");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  useEffect(() => {
    if (!showAllFilter && filter === "All") {
      setFilter(SCHOLARSHIP_STATUSES[0]);
    }
  }, [showAllFilter, filter]);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [quickViewId, setQuickViewId] = useState(null);

  const list = scholarships || [];

  const stats = useMemo(() => {
    const parse = (v) => {
      const n = parseFloat((v || "").toString().replace(/[^0-9.-]/g, ""));
      return isNaN(n) ? 0 : n;
    };
    const potential = list.filter((s) => s.status !== "Rejected").reduce((sum, s) => sum + parse(s.amount), 0);
    const awarded = list.filter((s) => s.status === "Awarded").reduce((sum, s) => sum + parse(s.amount), 0);
    const soon = list.filter((s) => {
      const d = daysUntil(s.deadline);
      return d !== null && d >= 0 && d <= 14;
    }).length;
    return { total: list.length, potential, awarded, soon };
  }, [list]);

  const filtered = useMemo(() => {
    let l = list;
    if (filter !== "All") l = l.filter((s) => s.status === filter);
    if (query.trim()) {
      const q = query.toLowerCase();
      l = l.filter((s) => s.name.toLowerCase().includes(q) || (s.sponsor || "").toLowerCase().includes(q));
    }
    return [...l].sort((a, b) => {
      const da = a.deadline ? new Date(a.deadline) : new Date("9999-12-31");
      const db = b.deadline ? new Date(b.deadline) : new Date("9999-12-31");
      return da - db;
    });
  }, [list, filter, query]);

  if (loading) {
    return (
      <div className="loading-state">
        <Loader2 className="spin" size={22} />
        <span>Loading your scholarships…</span>
      </div>
    );
  }

  const openAdd = () => { setDraft(emptyScholarship()); setIsEditing(false); };
  const openEdit = (item) => { setDraft({ ...item }); setIsEditing(true); };
  const closeModal = () => setDraft(null);
  const save = () => {
    if (!draft.name.trim()) return;
    const next = isEditing ? list.map((s) => (s.id === draft.id ? draft : s)) : [...list, draft];
    onPersist(next);
    setDraft(null);
  };
  const removeScholarship = (id) => {
    onPersist(list.filter((s) => s.id !== id));
    setConfirmDelete(null);
  };
  const changeStatus = (id, status) => {
    onPersist(list.map((s) => (s.id === id ? { ...s, status } : s)));
  };
  const openQuickView = (item) => setQuickViewId(item.id);
  const closeQuickView = () => setQuickViewId(null);
  const quickViewItem = quickViewId ? list.find((s) => s.id === quickViewId) || null : null;

  return (
    <div className="scholarships-page">
      <h1 className="sr-only">Scholarships</h1>
      <div className="stats-row">
        <StatCard label="Scholarships tracked" value={stats.total} icon={<Award size={16} />} />
        <StatCard label="Potential award total" value={`$${stats.potential.toLocaleString()}`} icon={<DollarSign size={16} />} accent="#2FBF71" />
        <StatCard label="Awarded so far" value={`$${stats.awarded.toLocaleString()}`} icon={<Star size={16} />} accent="#FFC857" />
        <StatCard label="Deadlines within 14 days" value={stats.soon} icon={<Calendar size={16} />} accent="#FF5C5C" />
      </div>

      <div className="controls-row">
        <div className="search-box">
          <Search size={15} strokeWidth={2.2} aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or sponsor" aria-label="Search scholarships by name or sponsor" />
        </div>
        <div className="chip-filters" role="group" aria-label="Filter scholarships by status">
          {(showAllFilter ? ["All", ...SCHOLARSHIP_STATUSES] : SCHOLARSHIP_STATUSES).map((s) => (
            <button
              key={s}
              className={`filter-chip ${filter === s ? "filter-chip-active" : ""}`}
              onClick={() => setFilter(s)}
              aria-pressed={filter === s}
            >
              {s !== "All" && <span className="chip-dot" style={{ background: SCHOLARSHIP_STATUS_META[s].dot }} />}
              {s}
            </button>
          ))}
        </div>
        <button className="btn btn-primary scholarships-add-btn" onClick={openAdd}>
          <Plus size={15} strokeWidth={2.5} />
          Add scholarship
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <Award size={22} />
          <p>{list.length === 0 ? "No scholarships tracked yet." : "Nothing matches those filters."}</p>
          {list.length === 0 && (
            <button className="btn btn-secondary" onClick={openAdd}>Add a scholarship</button>
          )}
        </div>
      ) : (
        <div className="scholarships-grid">
          {filtered.map((item) => (
            <ScholarshipCard
              key={item.id}
              item={item}
              onEdit={() => openEdit(item)}
              onDelete={() => setConfirmDelete(item.id)}
              onStatusChange={(s) => changeStatus(item.id, s)}
              onQuickView={() => openQuickView(item)}
            />
          ))}
        </div>
      )}

      {draft && (
        <ScholarshipModal
          draft={draft}
          setDraft={setDraft}
          isEditing={isEditing}
          onCancel={closeModal}
          onSave={save}
        />
      )}

      {quickViewItem && (
        <ScholarshipQuickView
          item={quickViewItem}
          onClose={closeQuickView}
          onEdit={() => { closeQuickView(); openEdit(quickViewItem); }}
          onStatusChange={(s) => changeStatus(quickViewItem.id, s)}
        />
      )}

      {confirmDelete && (
        <div className="overlay" onClick={() => setConfirmDelete(null)} onKeyDown={(e) => { if (e.key === "Escape") setConfirmDelete(null); }}>
          <div className="confirm-box" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true" aria-label="Remove this scholarship from your tracker?">
            <p>Remove this scholarship from your tracker?</p>
            <div className="confirm-actions">
              <button className="btn btn-ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => removeScholarship(confirmDelete)}>Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const FEATURE_LIST = [
  { icon: LayoutGrid, title: "Internship board", text: "Track every application by status, from researching to offer, in one board." },
  { icon: Zap, title: "Quick save", text: "Jot down just a company and a link now, fill in the rest whenever you get to it." },
  { icon: Video, title: "Interview tracking", text: "Log interview rounds with dates, times, Zoom links or addresses, and prep notes." },
  { icon: GraduationCap, title: "GPA tracker", text: "Log courses by semester with goal vs. actual grades, credits, and category." },
  { icon: Award, title: "Scholarship tracker", text: "Track scholarships by status, amount, deadline, and requirements." },
  { icon: BarChart3, title: "Stats & charts", text: "Visual breakdowns of your applications by status, work type, interest, and pay." },
];

function VolunteerCard({ item, onEdit, onDelete, onStatusChange, onQuickView }) {
  const [statusOpen, setStatusOpen] = useState(false);

  return (
    <div className="card" onClick={onQuickView} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onQuickView(); } }} role="button" tabIndex={0}>
      <div className="card-top">
        <div className="card-title">
          <span className="card-company">{item.organization || "Untitled organization"}</span>
          <span className="card-role">{item.role || "Role not set"}</span>
        </div>
        <div className="card-actions">
          <button className="icon-btn" onClick={(e) => { e.stopPropagation(); onQuickView(); }} aria-label="Quick view" title="Quick view">
            <Eye size={13} />
          </button>
          <button className="icon-btn" onClick={(e) => { e.stopPropagation(); onEdit(); }} aria-label="Edit" title="Edit">
            <Pencil size={13} />
          </button>
          <button className="icon-btn" onClick={(e) => { e.stopPropagation(); onDelete(); }} aria-label="Remove" title="Remove">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <div className="card-meta">
        {item.location && <span className="meta-item"><MapPin size={12} />{item.location}</span>}
        {item.hours && <span className="meta-item"><Clock size={12} />{item.hours} hrs</span>}
      </div>

      <div className="card-bottom">
        {item.date && <span className="chip chip-muted"><Calendar size={11} strokeWidth={2.5} />{item.date}</span>}
        {item.link && (
          <a
            className="link-btn"
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            title="Open listing"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink size={12} />
          </a>
        )}
      </div>

      <div className="status-select" onClick={(e) => e.stopPropagation()}>
        <button className="status-btn" onClick={() => setStatusOpen((v) => !v)}>
          <span className="chip-dot" style={{ background: VOLUNTEER_STATUS_META[item.status].dot }} />
          {item.status}
          <ChevronDown size={12} />
        </button>
        {statusOpen && (
          <div className="status-menu">
            {VOLUNTEER_STATUSES.map((s) => (
              <button
                key={s}
                className="status-menu-item"
                onClick={() => { onStatusChange(s); setStatusOpen(false); }}
              >
                <span className="chip-dot" style={{ background: VOLUNTEER_STATUS_META[s].dot }} />
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function VolunteerModal({ draft, setDraft, isEditing, onCancel, onSave }) {
  const set = (k) => (e) => setDraft({ ...draft, [k]: e.target.value });

  return (
    <div className="overlay" onClick={onCancel} onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="volunteer-modal-title">
        <div className="modal-head">
          <h2 id="volunteer-modal-title">{isEditing ? "Edit volunteer opportunity" : "Add volunteer opportunity"}</h2>
          <button className="icon-btn" onClick={onCancel} aria-label="Close"><X size={16} /></button>
        </div>

        <div className="modal-body">
          <div className="field-row">
            <label>
              Organization <span className="req">*</span>
              <input value={draft.organization} onChange={set("organization")} placeholder="e.g. Maryland SPCA" autoFocus maxLength={150} />
            </label>
            <label>
              Role / activity
              <input value={draft.role} onChange={set("role")} placeholder="e.g. Shelter assistant" />
            </label>
          </div>

          <div className="field-row">
            <label>
              Status
              <select value={draft.status} onChange={set("status")}>
                {VOLUNTEER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label>
              Hours
              <input value={draft.hours} onChange={set("hours")} placeholder="e.g. 12" inputMode="decimal" />
            </label>
          </div>

          <div className="field-row">
            <label>
              Date
              <input type="date" value={draft.date} onChange={set("date")} />
            </label>
            <label>
              Location
              <LocationInput value={draft.location} onChange={(v) => setDraft({ ...draft, location: v })} />
            </label>
          </div>

          <label className="field-full">
            Listing link
            <div className="input-with-icon">
              <Link2 size={13} />
              <input value={draft.link} onChange={set("link")} placeholder="https://..." />
            </div>
          </label>

          <label className="field-full">
            Notes
            <textarea value={draft.notes} onChange={set("notes")} rows={2} placeholder="Contacts, requirements, follow-ups…" />
          </label>
        </div>

        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={onSave} disabled={!draft.organization.trim()}>
            {isEditing ? "Save changes" : "Add opportunity"}
          </button>
        </div>
      </div>
    </div>
  );
}

function VolunteerQuickView({ item, onClose, onEdit, onStatusChange }) {
  return (
    <div className="overlay" onClick={onClose} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div className="qv-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="qv-volunteer-title">
        <div className="qv-head">
          <div>
            <h2 id="qv-volunteer-title" className="qv-company">{item.organization || "Untitled organization"}</h2>
            <div className="qv-role">{item.role || "Role not set"}</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        <div className="qv-status-row">
          {VOLUNTEER_STATUSES.map((s) => (
            <button
              key={s}
              className={`qv-status-pill ${item.status === s ? "qv-status-pill-active" : ""}`}
              style={item.status === s ? { background: VOLUNTEER_STATUS_META[s].dot, borderColor: VOLUNTEER_STATUS_META[s].dot } : {}}
              onClick={() => onStatusChange(s)}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="qv-body">
          <div className="qv-grid">
            {item.location && (
              <div className="qv-field">
                <span className="qv-field-label"><MapPin size={12} />Location</span>
                <span className="qv-field-value">{item.location}</span>
              </div>
            )}
            {item.hours && (
              <div className="qv-field">
                <span className="qv-field-label"><Clock size={12} />Hours</span>
                <span className="qv-field-value">{item.hours}</span>
              </div>
            )}
            {item.date && (
              <div className="qv-field">
                <span className="qv-field-label"><Calendar size={12} />Date</span>
                <span className="qv-field-value">{item.date}</span>
              </div>
            )}
          </div>

          {item.notes && (
            <div className="qv-section">
              <span className="qv-section-title"><StickyNote size={12} />Notes</span>
              <p className="qv-notes">{item.notes}</p>
            </div>
          )}
        </div>

        <div className="modal-foot">
          {item.link && (
            <a className="btn btn-ghost" href={item.link} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={13} />
              Open listing
            </a>
          )}
          <button className="btn btn-primary" onClick={onEdit}>
            <Pencil size={13} />
            Edit
          </button>
        </div>
      </div>
    </div>
  );
}

function VolunteerPage({ volunteering, loading, onPersist, showAllFilter }) {
  const [filter, setFilter] = useState("All");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  useEffect(() => {
    if (!showAllFilter && filter === "All") {
      setFilter(VOLUNTEER_STATUSES[0]);
    }
  }, [showAllFilter, filter]);
  const [quickViewId, setQuickViewId] = useState(null);

  const list = volunteering || [];

  const stats = useMemo(() => {
    const parse = (v) => {
      const n = parseFloat((v || "").toString().replace(/[^0-9.]/g, ""));
      return isNaN(n) ? 0 : n;
    };
    const totalHours = list.reduce((sum, v) => sum + parse(v.hours), 0);
    const completedHours = list.filter((v) => v.status === "Completed").reduce((sum, v) => sum + parse(v.hours), 0);
    const confirmed = list.filter((v) => v.status === "Confirmed").length;
    return { total: list.length, totalHours, completedHours, confirmed };
  }, [list]);

  const filtered = useMemo(() => {
    let l = list;
    if (filter !== "All") l = l.filter((v) => v.status === filter);
    if (query.trim()) {
      const q = query.toLowerCase();
      l = l.filter((v) => v.organization.toLowerCase().includes(q) || (v.role || "").toLowerCase().includes(q));
    }
    return [...l].sort((a, b) => {
      const da = a.date ? new Date(a.date) : new Date("9999-12-31");
      const db = b.date ? new Date(b.date) : new Date("9999-12-31");
      return da - db;
    });
  }, [list, filter, query]);

  if (loading) {
    return (
      <div className="loading-state">
        <Loader2 className="spin" size={22} />
        <span>Loading your volunteering…</span>
      </div>
    );
  }

  const openAdd = () => { setDraft(emptyVolunteer()); setIsEditing(false); };
  const openEdit = (item) => { setDraft({ ...item }); setIsEditing(true); };
  const closeModal = () => setDraft(null);
  const save = () => {
    if (!draft.organization.trim()) return;
    const next = isEditing ? list.map((v) => (v.id === draft.id ? draft : v)) : [...list, draft];
    onPersist(next);
    setDraft(null);
  };
  const removeVolunteer = (id) => {
    onPersist(list.filter((v) => v.id !== id));
    setConfirmDelete(null);
  };
  const changeStatus = (id, status) => {
    onPersist(list.map((v) => (v.id === id ? { ...v, status } : v)));
  };
  const openQuickView = (item) => setQuickViewId(item.id);
  const closeQuickView = () => setQuickViewId(null);
  const quickViewItem = quickViewId ? list.find((v) => v.id === quickViewId) || null : null;

  return (
    <div className="scholarships-page">
      <h1 className="sr-only">Volunteering</h1>
      <div className="stats-row">
        <StatCard label="Opportunities tracked" value={stats.total} icon={<HeartHandshake size={16} />} />
        <StatCard label="Hours logged" value={stats.completedHours} icon={<Clock size={16} />} accent="#2FBF71" />
        <StatCard label="Total hours (all statuses)" value={stats.totalHours} icon={<Star size={16} />} accent="#FFC857" />
        <StatCard label="Confirmed upcoming" value={stats.confirmed} icon={<Calendar size={16} />} accent="#3DA5FF" />
      </div>

      <div className="controls-row">
        <div className="search-box">
          <Search size={15} strokeWidth={2.2} aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by organization or role" aria-label="Search volunteering by organization or role" />
        </div>
        <div className="chip-filters" role="group" aria-label="Filter volunteering by status">
          {(showAllFilter ? ["All", ...VOLUNTEER_STATUSES] : VOLUNTEER_STATUSES).map((s) => (
            <button
              key={s}
              className={`filter-chip ${filter === s ? "filter-chip-active" : ""}`}
              onClick={() => setFilter(s)}
              aria-pressed={filter === s}
            >
              {s !== "All" && <span className="chip-dot" style={{ background: VOLUNTEER_STATUS_META[s].dot }} />}
              {s}
            </button>
          ))}
        </div>
        <button className="btn btn-primary scholarships-add-btn" onClick={openAdd}>
          <Plus size={15} strokeWidth={2.5} />
          Add opportunity
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <HeartHandshake size={22} />
          <p>{list.length === 0 ? "No volunteer opportunities tracked yet." : "Nothing matches those filters."}</p>
          {list.length === 0 && (
            <button className="btn btn-secondary" onClick={openAdd}>Add an opportunity</button>
          )}
        </div>
      ) : (
        <div className="scholarships-grid">
          {filtered.map((item) => (
            <VolunteerCard
              key={item.id}
              item={item}
              onEdit={() => openEdit(item)}
              onDelete={() => setConfirmDelete(item.id)}
              onStatusChange={(s) => changeStatus(item.id, s)}
              onQuickView={() => openQuickView(item)}
            />
          ))}
        </div>
      )}

      {draft && (
        <VolunteerModal
          draft={draft}
          setDraft={setDraft}
          isEditing={isEditing}
          onCancel={closeModal}
          onSave={save}
        />
      )}

      {quickViewItem && (
        <VolunteerQuickView
          item={quickViewItem}
          onClose={closeQuickView}
          onEdit={() => { closeQuickView(); openEdit(quickViewItem); }}
          onStatusChange={(s) => changeStatus(quickViewItem.id, s)}
        />
      )}

      {confirmDelete && (
        <div className="overlay" onClick={() => setConfirmDelete(null)} onKeyDown={(e) => { if (e.key === "Escape") setConfirmDelete(null); }}>
          <div className="confirm-box" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true" aria-label="Remove this volunteer opportunity from your tracker?">
            <p>Remove this volunteer opportunity from your tracker?</p>
            <div className="confirm-actions">
              <button className="btn btn-ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => removeVolunteer(confirmDelete)}>Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const GAME_LIST = [
  {
    title: "Wordle",
    sponsor: "The New York Times",
    description: "Guess the five-letter word in six tries, a quick daily warm-up for your brain.",
    url: "https://www.nytimes.com/games/wordle/index.html",
    icon: Puzzle,
    categories: ["verbal"],
  },
  {
    title: "Connections",
    sponsor: "The New York Times",
    description: "Find the hidden groups of four among sixteen words. Trickier than it looks.",
    url: "https://www.nytimes.com/games/connections",
    icon: Grid3x3,
    categories: ["verbal", "pattern"],
  },
  {
    title: "Spelling Bee",
    sponsor: "The New York Times",
    description: "Make as many words as you can from seven letters. Every word needs the center one.",
    url: "https://www.nytimes.com/puzzles/spelling-bee",
    icon: Hexagon,
    categories: ["verbal"],
  },
  {
    title: "Sudoku",
    sponsor: "The New York Times",
    description: "Fill the grid so every row, column, and box has one of each number. Classic focus training.",
    url: "https://www.nytimes.com/puzzles/sudoku",
    icon: Hash,
    categories: ["quantitative"],
  },
  {
    title: "Krillion",
    sponsor: "krillion.io",
    description: "A quick daily brain teaser to reset your focus between applications.",
    url: "https://krillion.io",
    icon: Brain,
    categories: ["general"],
  },
  {
    title: "Semantle",
    sponsor: "semantle.com",
    description: "Guess the secret word using AI-powered hints on how close your guesses are in meaning.",
    url: "https://semantle.com/",
    icon: Search,
    categories: ["verbal"],
  },
  {
    title: "Minute Cryptic",
    sponsor: "minutecryptic.com",
    description: "One cryptic crossword clue a day, a bite-sized way to sharpen your wordplay skills.",
    url: "https://www.minutecryptic.com/",
    icon: Lightbulb,
    categories: ["verbal"],
  },
  {
    title: "Zip",
    sponsor: "LinkedIn",
    description: "Trace a single path connecting numbered dots in order, without crossing yourself.",
    url: "https://www.linkedin.com/games/zip/",
    icon: Gamepad2,
    categories: ["quantitative", "pattern"],
  },
  {
    title: "Wend",
    sponsor: "LinkedIn",
    description: "Trace four hidden words through a letter grid, bending around walls, using every tile exactly once.",
    url: "https://www.linkedin.com/games/wend/",
    icon: Route,
    categories: ["verbal", "pattern"],
  },
  {
    title: "Countryle",
    sponsor: "guessthecountry.org",
    description: "Guess the mystery country from clues like continent, population, and coordinates after each try.",
    url: "https://guessthecountry.org/countryle/",
    icon: Search,
    categories: ["geography"],
  },
  {
    title: "Pydle",
    sponsor: "pydle.net",
    description: "A Wordle clone built in Python. Guess the word, sharpen your coding brain in the process.",
    url: "https://pydle.net",
    icon: Terminal,
    categories: ["coding"],
  },
];

const MAJOR_CATEGORY_KEYWORDS = {
  quantitative: [
    "math", "statistic", "physic", "engineer", "actuarial", "accounting", "finance",
    "economic", "chemistry", "biochemistry", "chemical", "robotics", "mechatronics",
    "nuclear", "astro", "geology", "geophysics", "quantitative",
  ],
  verbal: [
    "english", "writing", "journalism", "communication", "linguistic", "language",
    "literature", "education", "history", "law", "philosophy",
    "spanish", "french", "german", "chinese", "japanese", "korean", "italian",
    "portuguese", "russian", "latin", "media", "public relations",
    "theatre", "translation", "classics", "screenwriting", "playwriting", "poetry",
  ],
  pattern: [
    "art", "design", "architecture", "music", "game design", "animation",
    "photography", "film", "sculpture", "painting", "fashion", "interior design",
  ],
  coding: [
    "computer science", "computer engineering", "software", "data science",
    "information technology", "information systems", "cybersecurity",
    "web development", "game development", "programming", "bioinformatics",
  ],
  geography: [
    "geography", "international relations", "global studies", "environmental science",
    "environmental studies", "urban studies", "urban planning", "political science",
  ],
};

// Only recommends games whose tagged category genuinely overlaps a major's matched
// category - no fallback/default picks, so an unmatched major returns nothing.
function recommendedGamesForMajor(major) {
  if (!major || !major.trim()) return [];
  const m = major.toLowerCase();
  const matchedCategories = Object.entries(MAJOR_CATEGORY_KEYWORDS)
    .filter(([, keywords]) => keywords.some((kw) => m.includes(kw)))
    .map(([cat]) => cat);
  if (matchedCategories.length === 0) return [];
  const scored = GAME_LIST.map((g) => {
    const overlap = g.categories.filter((c) => matchedCategories.includes(c)).length;
    return { game: g, overlap };
  }).filter((s) => s.overlap > 0);
  scored.sort((a, b) => b.overlap - a.overlap);
  return scored.map((s) => s.game);
}

function GamesPage({ favorites, onToggleFavorite, major }) {
  const favSet = new Set(favorites || []);
  const recommendedGames = useMemo(() => recommendedGamesForMajor(major).slice(0, 3), [major]);
  const recommendedTitles = new Set(recommendedGames.map((g) => g.title));
  const hasMajor = !!(major && major.trim());

  const remaining = GAME_LIST.filter((g) => !recommendedTitles.has(g.title));
  const favoriteGames = remaining.filter((g) => favSet.has(g.title));
  const otherGames = remaining.filter((g) => !favSet.has(g.title));

  const renderCard = (g) => {
    const isFav = favSet.has(g.title);
    return (
      <TiltCard as="a" className="game-card" key={g.title} href={g.url} target="_blank" rel="noopener noreferrer">
        <button
          className={`game-favorite ${isFav ? "game-favorite-active" : ""}`}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleFavorite(g.title); }}
          title={isFav ? "Remove from favorites" : "Add to favorites"}
        >
          <Star size={15} fill={isFav ? "currentColor" : "none"} />
        </button>
        <span className="game-icon"><g.icon size={20} /></span>
        <span className="game-title">{g.title}</span>
        <span className="game-sponsor">{g.sponsor}</span>
        <span className="game-text">{g.description}</span>
        <span className="game-play">
          Play <ExternalLink size={12} />
        </span>
      </TiltCard>
    );
  };

  return (
    <div className="games-page">
      <div className="dashboard-welcome">
        <h1 className="dashboard-welcome-title">Take a brain break</h1>
        <p className="dashboard-welcome-sub">
          A few minutes of puzzles between applications can help reset your focus. Here are a few good ones.
        </p>
      </div>

      {hasMajor && (
        <div className="games-section">
          <h3 className="games-section-title">
            <GraduationCap size={14} />
            Picked for {major} majors
          </h3>
          {recommendedGames.length > 0 ? (
            <div className="games-grid">
              {recommendedGames.map(renderCard)}
            </div>
          ) : (
            <p className="games-section-empty">
              We don't have a game recommendation for {major} yet. Browse everything below instead.
            </p>
          )}
        </div>
      )}

      {favoriteGames.length > 0 && (
        <div className="games-section">
          <h3 className="games-section-title">
            <Star size={14} fill="currentColor" />
            Your favorites
          </h3>
          <div className="games-grid">
            {favoriteGames.map(renderCard)}
          </div>
        </div>
      )}

      <div className="games-section">
        {(favoriteGames.length > 0 || hasMajor) && <h3 className="games-section-title">All games</h3>}
        <div className="games-grid">
          {otherGames.map(renderCard)}
        </div>
      </div>
    </div>
  );
}

function DashboardPage({ account, apps, semesters, gpaSettings, scholarships, onNavigate }) {
  const appList = apps || [];
  const semesterList = semesters || [];
  const scholarshipList = scholarships || [];
  const gradePoints = scaleToPoints(gpaSettings?.gradeScale?.length ? gpaSettings.gradeScale : DEFAULT_GRADE_SCALE);

  const internshipTotal = appList.length;
  const activeApps = appList.filter((a) => a.status === "Applied" || a.status === "Interviewing").length;
  const offers = appList.filter((a) => a.status === "Offer").length;

  const cumulative = cumulativeGpa(semesterList, gradePoints);
  const overallGpa = cumulative.gpa === null ? "N/A" : cumulative.gpa.toFixed(2);

  const scholarshipTotal = scholarshipList.length;
  const potentialAward = scholarshipList
    .filter((s) => s.status !== "Rejected")
    .reduce((sum, s) => {
      const n = parseFloat((s.amount || "").toString().replace(/[^0-9.-]/g, ""));
      return sum + (isNaN(n) ? 0 : n);
    }, 0);

  const firstName = (account?.name || "").split(" ")[0];

  return (
    <div className="dashboard-page">
      <div className="dashboard-welcome">
        <h1 className="dashboard-welcome-title">
          {firstName ? `Welcome back, ${firstName}` : "Welcome to Internly"}
        </h1>
        <p className="dashboard-welcome-sub">Here's everything in one place: internships, academics, and scholarships.</p>
      </div>

      <div className="stats-row dashboard-stats-row-3">
        <StatCard label="Internships tracked" value={internshipTotal} icon={<Briefcase size={16} />} />
        <StatCard label="Overall GPA" value={overallGpa} icon={<GraduationCap size={16} />} accent="#3DA5FF" />
        <StatCard label="Scholarships tracked" value={scholarshipTotal} icon={<Award size={16} />} accent="#FFC857" />
      </div>

      <div className="dashboard-nav-cards">
        <TiltCard as="button" className="dashboard-nav-card" onClick={() => onNavigate("internships")}>
          <span className="dashboard-nav-icon" style={{ background: "#FFE7DE", color: "var(--coral)" }}>
            <Briefcase size={18} />
          </span>
          <span className="dashboard-nav-title">Internships</span>
          <span className="dashboard-nav-detail">{activeApps} active · {offers} offer{offers === 1 ? "" : "s"}</span>
          <span className="dashboard-nav-go">Open <ArrowRight size={12} /></span>
        </TiltCard>

        <TiltCard as="button" className="dashboard-nav-card" onClick={() => onNavigate("academics")}>
          <span className="dashboard-nav-icon" style={{ background: "#E9F2FF", color: "#3DA5FF" }}>
            <GraduationCap size={18} />
          </span>
          <span className="dashboard-nav-title">Academics</span>
          <span className="dashboard-nav-detail">{semesterList.length} semester{semesterList.length === 1 ? "" : "s"} · {cumulative.credits} credits</span>
          <span className="dashboard-nav-go">Open <ArrowRight size={12} /></span>
        </TiltCard>

        <TiltCard as="button" className="dashboard-nav-card" onClick={() => onNavigate("scholarships")}>
          <span className="dashboard-nav-icon" style={{ background: "#FFF3D6", color: "#B8790C" }}>
            <Award size={18} />
          </span>
          <span className="dashboard-nav-title">Scholarships</span>
          <span className="dashboard-nav-detail">${potentialAward.toLocaleString()} potential</span>
          <span className="dashboard-nav-go">Open <ArrowRight size={12} /></span>
        </TiltCard>
      </div>
    </div>
  );
}

function SettingsPage({ logoId, onChangeLogo, account, onUpdateAccount, onSignOut, onDeleteAccount, gpaSettings, onUpdateGpaSettings, showAllFilter, onSetShowAllFilter }) {
  const [profile, setProfile] = useState(account?.profile || emptyProfile());
  const [saved, setSaved] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [bugSummary, setBugSummary] = useState("");
  const [bugDetails, setBugDetails] = useState("");
  const [bugSent, setBugSent] = useState(false);

  const setField = (k) => (e) => { setProfile({ ...profile, [k]: e.target.value }); setSaved(false); };

  const saveProfile = () => {
    onUpdateAccount({ ...account, profile });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const sendBugReport = () => {
    const subject = encodeURIComponent(`Internly bug report${bugSummary.trim() ? `: ${bugSummary.trim()}` : ""}`);
    const bodyLines = [
      bugDetails.trim() || "(no details provided)",
      "",
      "---",
      `Reported by: ${account?.name || "Unknown"} (${account?.email || "no email on file"})`,
    ];
    const body = encodeURIComponent(bodyLines.join("\n"));
    window.location.href = `mailto:gileskamani@gmail.com?subject=${subject}&body=${body}`;
    setBugSent(true);
    setTimeout(() => setBugSent(false), 3000);
  };

  const toggleGpaSetting = (key) => {
    if (!gpaSettings || !onUpdateGpaSettings) return;
    onUpdateGpaSettings({ ...gpaSettings, [key]: !gpaSettings[key] });
  };

  return (
    <div className="settings-page">
      <h1 className="sr-only">Settings</h1>
      <div className="settings-section">
        <h3 className="settings-title">About Internly</h3>
        <p className="settings-sub" style={{ marginBottom: 0 }}>
          Internly is an independent tool for tracking your own internship search, GPA, scholarships,
          and volunteering. It is not affiliated with, endorsed by, or officially connected to any
          school, university, employer, or career platform. It's simply a personal organizer.
        </p>
      </div>

      <div className="settings-section">
        <h3 className="settings-title">App icon</h3>
        <p className="settings-sub">Pick which logo shows up at the top of Internly.</p>
        <div className="logo-picker">
          {LOGO_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              className={`logo-option ${logoId === opt.id ? "logo-option-active" : ""}`}
              onClick={() => onChangeLogo(opt.id)}
            >
              <span className="logo-option-img">
                <img src={opt.src} alt={opt.label} />
                {logoId === opt.id && (
                  <span className="logo-option-check"><Check size={13} strokeWidth={3} /></span>
                )}
              </span>
              <span className="logo-option-label">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>

      {gpaSettings && onUpdateGpaSettings && (
        <div className="settings-section">
          <h3 className="settings-title">Academics page sections</h3>
          <p className="settings-sub">Turn on the extras you want. Everything stays off by default to keep Academics tidy.</p>
          <ToggleSwitch
            checked={!!gpaSettings.showCumulativeChart}
            onChange={() => toggleGpaSetting("showCumulativeChart")}
            label="Cumulative GPA by semester"
            description="Line chart of your running GPA over time"
          />
          <ToggleSwitch
            checked={!!gpaSettings.showCategoryBreakdown}
            onChange={() => toggleGpaSetting("showCategoryBreakdown")}
            label="Credits by category"
            description="Major / Gen-Ed / Elective breakdown, planned vs. completed"
          />
          <ToggleSwitch
            checked={!!gpaSettings.showWhatIfCalculator}
            onChange={() => toggleGpaSetting("showWhatIfCalculator")}
            label="What-if grade calculator"
            description="The GPA you'd need next semester to hit a target"
          />
          <ToggleSwitch
            checked={!!gpaSettings.showGradeDistribution}
            onChange={() => toggleGpaSetting("showGradeDistribution")}
            label="Grade distribution chart"
            description="Goal vs. actual grades, by letter"
          />
        </div>
      )}

      {typeof showAllFilter === "boolean" && onSetShowAllFilter && (
        <div className="settings-section">
          <h3 className="settings-title">Filters</h3>
          <p className="settings-sub">Applies to Internships, Scholarships, and Volunteering.</p>
          <ToggleSwitch
            checked={showAllFilter}
            onChange={() => onSetShowAllFilter(!showAllFilter)}
            label='Show the "All" filter'
            description='Turn off to hide "All" and only show individual statuses like Applied or Rejected.'
          />
        </div>
      )}

      {account && (
        <div className="settings-section">
          <h3 className="settings-title">Your account</h3>
          <p className="settings-sub">{account.name} · {account.email}</p>

          <div className="field-row">
            <label>
              School
              <input value={profile.school} onChange={setField("school")} placeholder="e.g. University of Maryland" maxLength={150} />
            </label>
            <label>
              Major
              <MajorInput value={profile.major} onChange={(v) => { setProfile({ ...profile, major: v }); setSaved(false); }} />
            </label>
          </div>

          <div className="field-row">
            <label>
              Degree level
              <select value={profile.degreeLevel} onChange={setField("degreeLevel")}>
                {DEGREE_LEVELS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label>
              Expected graduation
              <select value={profile.gradYear} onChange={setField("gradYear")}>
                <option value="">Select year</option>
                {GRAD_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
          </div>

          <div className="field-row">
            {profile.degreeLevel === "Bachelor's" ? (
              <label>
                Degree type
                <select value={profile.bachelorType} onChange={setField("bachelorType")}>
                  {BACHELOR_TYPES.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
            ) : (
              <label>
                Degree type
                <input value={profile.bachelorType} onChange={setField("bachelorType")} placeholder="e.g. M.S., Ph.D." />
              </label>
            )}
            <label>
              GPA
              <input value={profile.gpa} onChange={setField("gpa")} placeholder="e.g. 3.75" inputMode="decimal" />
            </label>
          </div>

          <label className="field-full">
            Desired role
            <input value={profile.desiredRole} onChange={setField("desiredRole")} placeholder="e.g. Software Engineering Intern" />
          </label>

          <div className="settings-actions">
            <button className="btn btn-primary" onClick={saveProfile}>
              {saved ? <Check size={14} /> : null}
              {saved ? "Saved" : "Save changes"}
            </button>
          </div>
        </div>
      )}

      <div className="settings-section">
        <h3 className="settings-title">Report a bug</h3>
        <p className="settings-sub">
          Found something broken? You can report bugs here. It opens your email app with a message ready to send.
        </p>
        <label className="field-full">
          Summary
          <input
            value={bugSummary}
            onChange={(e) => setBugSummary(e.target.value)}
            placeholder="e.g. Interview link doesn't open"
          />
        </label>
        <label className="field-full">
          What happened?
          <textarea
            value={bugDetails}
            onChange={(e) => setBugDetails(e.target.value)}
            rows={4}
            placeholder="What you were doing, what you expected, and what happened instead…"
          />
        </label>
        <div className="settings-actions">
          <button className="btn btn-primary" onClick={sendBugReport}>
            {bugSent ? <Check size={14} /> : <Bug size={14} />}
            {bugSent ? "Email app opened" : "Send bug report"}
          </button>
        </div>
      </div>

      {account && (
        <div className="settings-section">
          <h3 className="settings-title">Sign out</h3>
          <p className="settings-sub">Your job data stays saved. You'll just need to sign back in.</p>
          {confirmSignOut ? (
            <div className="settings-actions">
              <button className="btn btn-ghost" onClick={() => setConfirmSignOut(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={onSignOut}>
                <LogOut size={13} />
                Confirm sign out
              </button>
            </div>
          ) : (
            <div className="settings-actions">
              <button className="btn btn-ghost" onClick={() => setConfirmSignOut(true)}>
                <LogOut size={13} />
                Sign out
              </button>
            </div>
          )}
        </div>
      )}

      {account && (
        <div className="settings-section settings-section-danger">
          <h3 className="settings-title">Delete account</h3>
          <p className="settings-sub">
            Permanently erases everything you've saved, internships, GPA and semesters, scholarships,
            and volunteering, and removes your login entirely. This can't be undone.
          </p>
          {confirmDeleteAccount ? (
            <>
              <label className="field-full">
                Type DELETE to confirm
                <input
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="DELETE"
                  autoFocus
                />
              </label>
              {deleteError && (
                <p className="settings-sub" style={{ color: "#D8393F" }}>{deleteError}</p>
              )}
              <div className="settings-actions">
                <button
                  className="btn btn-ghost"
                  onClick={() => { setConfirmDeleteAccount(false); setDeleteConfirmText(""); setDeleteError(""); }}
                  disabled={deleting}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-danger"
                  disabled={deleteConfirmText.trim().toUpperCase() !== "DELETE" || deleting}
                  onClick={async () => {
                    setDeleting(true);
                    setDeleteError("");
                    const result = await onDeleteAccount();
                    setDeleting(false);
                    if (!result?.success) {
                      setDeleteError(result?.message || "Something went wrong. Please try again.");
                    }
                  }}
                >
                  <Trash2 size={13} />
                  {deleting ? "Deleting…" : "Permanently delete"}
                </button>
              </div>
            </>
          ) : (
            <div className="settings-actions">
              <button className="btn btn-danger" onClick={() => setConfirmDeleteAccount(true)}>
                <Trash2 size={13} />
                Delete account
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AuraBackground({ children, tall, contentClassName }) {
  const stageRef = React.useRef(null);
  const blobRefs = React.useRef([]);

  const handleMouseMove = (e) => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    stage.style.setProperty("--mx", `${(px * 100).toFixed(2)}%`);
    stage.style.setProperty("--my", `${(py * 100).toFixed(2)}%`);
    blobRefs.current.forEach((el, i) => {
      if (!el) return;
      const depth = (i + 1) * 7;
      const dx = (px - 0.5) * depth;
      const dy = (py - 0.5) * depth;
      el.style.setProperty("--px", `${dx.toFixed(1)}px`);
      el.style.setProperty("--py", `${dy.toFixed(1)}px`);
    });
  };

  const handleMouseLeave = () => {
    const stage = stageRef.current;
    if (stage) {
      stage.style.setProperty("--mx", "50%");
      stage.style.setProperty("--my", "38%");
    }
    blobRefs.current.forEach((el) => {
      if (!el) return;
      el.style.setProperty("--px", "0px");
      el.style.setProperty("--py", "0px");
    });
  };

  return (
    <div
      className={`aura-stage ${tall ? "aura-stage-tall" : ""}`}
      ref={stageRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <div className="aura-blob aura-blob-1" ref={(el) => (blobRefs.current[0] = el)} />
      <div className="aura-blob aura-blob-2" ref={(el) => (blobRefs.current[1] = el)} />
      <div className="aura-blob aura-blob-3" ref={(el) => (blobRefs.current[2] = el)} />
      <div className="aura-blob aura-blob-4" ref={(el) => (blobRefs.current[3] = el)} />
      <div className="aura-glow" />
      <div className={`aura-content ${contentClassName || ""}`}>
        {children}
      </div>
    </div>
  );
}

function AuraEmptyState() {
  return (
    <AuraBackground>
      <span className="aura-icon"><Video size={20} strokeWidth={2.2} /></span>
      <p className="aura-title">No interviews scheduled yet</p>
      <span className="aura-hint">Open an internship and add an interview round to see it here.</span>
    </AuraBackground>
  );
}

function InterviewsPage({ apps, onEditApp }) {
  const list = apps || [];

  const allInterviews = useMemo(() => {
    const rows = [];
    list.forEach((app) => {
      (app.interviews || []).forEach((iv) => {
        rows.push({ iv, app, dt: interviewDateTime(iv) });
      });
    });
    return rows;
  }, [list]);

  const now = new Date();
  const upcoming = allInterviews
    .filter((r) => r.dt && r.dt >= now)
    .sort((a, b) => a.dt - b.dt);
  const past = allInterviews
    .filter((r) => !r.dt || r.dt < now)
    .sort((a, b) => (b.dt || 0) - (a.dt || 0));

  if (allInterviews.length === 0) {
    return <AuraEmptyState />;
  }

  return (
    <div className="interviews-page">
      <InterviewGroup title="Upcoming" rows={upcoming} onEditApp={onEditApp} emptyText="Nothing on the calendar right now." />
      <InterviewGroup title="Past" rows={past} onEditApp={onEditApp} emptyText="No past interviews yet." muted />
    </div>
  );
}

function InterviewGroup({ title, rows, onEditApp, emptyText, muted }) {
  return (
    <div className="iv-group">
      <h3 className="iv-group-title">{title}</h3>
      {rows.length === 0 ? (
        <div className="iv-group-empty">{emptyText}</div>
      ) : (
        <div className="iv-cards">
          {rows.map(({ iv, app }) => (
            <div className={`iv-card ${muted ? "iv-card-muted" : ""}`} key={iv.id}>
              <div className="iv-card-date">
                <span className="iv-card-day">{formatInterviewDate(iv.date)}</span>
                {iv.time && <span className="iv-card-time">{formatInterviewTime(iv.time)}</span>}
              </div>
              <div className="iv-card-main">
                <div className="iv-card-top">
                  <span className="iv-card-company">{app.company}</span>
                  <span className="iv-card-type">
                    <InterviewTypeIcon type={iv.type} size={12} />
                    {iv.type}
                  </span>
                </div>
                <span className="iv-card-role">{app.jobTitle || "Role not set"}</span>
                {iv.location && (
                  isUrl(iv.location) ? (
                    <a className="iv-card-link" href={iv.location} target="_blank" rel="noopener noreferrer">
                      <ExternalLink size={12} />Join link
                    </a>
                  ) : (
                    <span className="iv-card-loc"><MapPin size={12} />{iv.location}</span>
                  )
                )}
                {iv.notes && <span className="iv-card-notes">{iv.notes}</span>}
              </div>
              <button className="btn btn-ghost iv-card-edit" onClick={() => onEditApp(app)}>
                <Pencil size={12} />
                Edit
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TiltCard({ as: Tag = "div", className = "", children, ...rest }) {
  const ref = React.useRef(null);

  const handleMove = (e) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const rotateY = (px - 0.5) * 8;
    const rotateX = (0.5 - py) * 8;
    el.style.transform = `perspective(700px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-3px)`;
    el.style.setProperty("--shine-x", `${(px * 100).toFixed(1)}%`);
    el.style.setProperty("--shine-y", `${(py * 100).toFixed(1)}%`);
  };

  const handleLeave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = "";
  };

  return (
    <Tag
      ref={ref}
      className={`tilt-card ${className}`}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      {...rest}
    >
      <span className="tilt-shine" />
      <span className="tilt-card-inner">{children}</span>
    </Tag>
  );
}

function StatCard({ label, value, icon, accent = "#FF6B47" }) {
  return (
    <div className="stat-card">
      <div className="stat-icon" style={{ color: accent, background: `${accent}1A` }}>
        {icon}
      </div>
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

function Card({ item, onEdit, onDelete, onStatusChange, onQuickView, wide }) {
  const [statusOpen, setStatusOpen] = useState(false);
  const pay = item.hourlyRate ? `$${item.hourlyRate}/hr` : item.salary ? item.salary : null;

  return (
    <div className={`card ${wide ? "card-wide" : ""}`} onClick={onQuickView} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onQuickView(); } }} role="button" tabIndex={0}>
      <div className="card-top">
        <div className="card-title">
          <span className="card-company">{item.company}</span>
          <span className="card-role">{item.jobTitle || "Role not set"}</span>
        </div>
        <div className="card-actions">
          <button className="icon-btn" onClick={(e) => { e.stopPropagation(); onQuickView(); }} aria-label="Quick view" title="Quick view">
            <Eye size={13} />
          </button>
          <button className="icon-btn" onClick={(e) => { e.stopPropagation(); onEdit(); }} aria-label="Edit" title="Edit">
            <Pencil size={13} />
          </button>
          <button className="icon-btn" onClick={(e) => { e.stopPropagation(); onDelete(); }} aria-label="Remove" title="Remove">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <div className="card-meta">
        {item.location && (
          <span className="meta-item"><MapPin size={12} />{item.location}</span>
        )}
        <span className="meta-item"><WorkTypeIcon type={item.workType} />{item.workType}</span>
        {pay && <span className="meta-item"><DollarSign size={12} />{pay}</span>}
      </div>

      <div className="card-bottom">
        {item.status !== "Researching" && item.dateApplied && (
          <AppliedChip dateApplied={item.dateApplied} />
        )}
        <DeadlineChip deadline={item.deadline} />
        <InterviewChip interviews={item.interviews} />
        <InterestDots level={item.interest} />
        {item.link && (
          <a
            className="link-btn"
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            title="Open listing"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink size={12} />
          </a>
        )}
      </div>

      <div className="status-select" onClick={(e) => e.stopPropagation()}>
        <button className="status-btn" onClick={() => setStatusOpen((v) => !v)}>
          <span className="chip-dot" style={{ background: STATUS_META[item.status].dot }} />
          {item.status}
          <ChevronDown size={12} />
        </button>
        {statusOpen && (
          <div className="status-menu">
            {STATUSES.map((s) => (
              <button
                key={s}
                className="status-menu-item"
                onClick={() => { onStatusChange(s); setStatusOpen(false); }}
              >
                <span className="chip-dot" style={{ background: STATUS_META[s].dot }} />
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function QuickViewModal({ item, onClose, onEdit, onStatusChange }) {
  const pay = item.hourlyRate ? `$${item.hourlyRate}/hr` : item.salary ? item.salary : null;
  const upcoming = nextUpcomingInterview(item.interviews);
  const pastInterviews = (item.interviews || [])
    .filter((iv) => !upcoming || iv.id !== upcoming.iv.id)
    .filter((iv) => interviewDateTime(iv) && interviewDateTime(iv) < new Date())
    .sort((a, b) => interviewDateTime(b) - interviewDateTime(a));

  return (
    <div className="overlay" onClick={onClose} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div className="qv-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="qv-internship-title">
        <div className="qv-head">
          <div>
            <h2 id="qv-internship-title" className="qv-company">{item.company}</h2>
            <div className="qv-role">{item.jobTitle || "Role not set"}</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        <div className="qv-status-row">
          {STATUSES.map((s) => (
            <button
              key={s}
              className={`qv-status-pill ${item.status === s ? "qv-status-pill-active" : ""}`}
              style={item.status === s ? { background: STATUS_META[s].dot, borderColor: STATUS_META[s].dot } : {}}
              onClick={() => onStatusChange(s)}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="qv-body">
          <div className="qv-grid">
            {item.location && (
              <div className="qv-field">
                <span className="qv-field-label"><MapPin size={12} />Location</span>
                <span className="qv-field-value">{item.location}</span>
              </div>
            )}
            <div className="qv-field">
              <span className="qv-field-label"><WorkTypeIcon type={item.workType} />Work type</span>
              <span className="qv-field-value">{item.workType}</span>
            </div>
            {pay && (
              <div className="qv-field">
                <span className="qv-field-label"><DollarSign size={12} />Pay</span>
                <span className="qv-field-value">{pay}</span>
              </div>
            )}
            <div className="qv-field">
              <span className="qv-field-label"><Star size={12} />Interest</span>
              <span className="qv-field-value"><InterestDots level={item.interest} /></span>
            </div>
          </div>

          <div className="qv-chips">
            {item.status !== "Researching" && item.dateApplied && <AppliedChip dateApplied={item.dateApplied} />}
            <DeadlineChip deadline={item.deadline} />
          </div>

          {upcoming && (
            <div className="qv-section">
              <span className="qv-section-title">Next interview</span>
              <div className="qv-interview">
                <div className="qv-interview-icon"><InterviewTypeIcon type={upcoming.iv.type} size={14} /></div>
                <div className="qv-interview-body">
                  <span className="qv-interview-date">
                    {formatInterviewDate(upcoming.iv.date)}{upcoming.iv.time ? ` · ${formatInterviewTime(upcoming.iv.time)}` : ""}
                  </span>
                  {upcoming.iv.location && (
                    isUrl(upcoming.iv.location) ? (
                      <a className="iv-row-link" href={upcoming.iv.location} target="_blank" rel="noopener noreferrer">
                        <Link2 size={11} />{upcoming.iv.location}
                      </a>
                    ) : (
                      <span className="iv-row-loc"><MapPin size={11} />{upcoming.iv.location}</span>
                    )
                  )}
                  {upcoming.iv.notes && <span className="iv-row-notes">{upcoming.iv.notes}</span>}
                </div>
              </div>
            </div>
          )}

          {pastInterviews.length > 0 && (
            <div className="qv-section">
              <span className="qv-section-title">Past interviews</span>
              {pastInterviews.map((iv) => (
                <div className="qv-interview qv-interview-muted" key={iv.id}>
                  <div className="qv-interview-icon"><InterviewTypeIcon type={iv.type} size={14} /></div>
                  <div className="qv-interview-body">
                    <span className="qv-interview-date">
                      {formatInterviewDate(iv.date)}{iv.time ? ` · ${formatInterviewTime(iv.time)}` : ""}
                    </span>
                    {iv.notes && <span className="iv-row-notes">{iv.notes}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {item.notes && (
            <div className="qv-section">
              <span className="qv-section-title"><StickyNote size={12} />Notes</span>
              <p className="qv-notes">{item.notes}</p>
            </div>
          )}
        </div>

        <div className="modal-foot">
          {item.link && (
            <a className="btn btn-ghost" href={item.link} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={13} />
              Open listing
            </a>
          )}
          <button className="btn btn-primary" onClick={onEdit}>
            <Pencil size={13} />
            Edit
          </button>
        </div>
      </div>
    </div>
  );
}

function LocationInput({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const wrapRef = React.useRef(null);
  const debounceRef = React.useRef(null);
  const abortRef = React.useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Live worldwide place search via OpenStreetMap's free Nominatim geocoder -
  // covers every city/town on Earth instead of a fixed list.
  useEffect(() => {
    const q = (value || "").trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.length < 2 || q.toLowerCase() === "remote") {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=8&q=${encodeURIComponent(q)}`,
          { signal: controller.signal }
        );
        const data = await res.json();
        const seen = new Set();
        const places = (Array.isArray(data) ? data : [])
          .filter((d) => d.class === "place" || d.class === "boundary")
          .map((d) => {
            const a = d.address || {};
            const name = a.city || a.town || a.village || a.hamlet || a.municipality || (d.display_name || "").split(",")[0];
            const region = a.state || a.region || a.county || "";
            const country = a.country || "";
            return [name, region, country].filter(Boolean).join(", ");
          })
          .filter((label) => {
            if (!label || seen.has(label)) return false;
            seen.add(label);
            return true;
          });
        setSuggestions(places);
      } catch (e) {
        if (e.name !== "AbortError") setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [value]);

  const select = (loc) => {
    onChange(loc);
    setOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = (e) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      if (activeIndex >= 0) {
        e.preventDefault();
        select(suggestions[activeIndex]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="loc-wrap" ref={wrapRef}>
      <div className="input-with-icon">
        <MapPin size={13} />
        <input
          value={value}
          onChange={(e) => { onChange(e.target.value); setOpen(true); setActiveIndex(-1); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="City, Country (or Remote)"
          autoComplete="off"
        />
        {loading && <Loader2 size={13} className="spin" />}
      </div>
      {open && suggestions.length > 0 && (
        <div className="loc-suggestions">
          {suggestions.map((loc, i) => (
            <button
              key={loc}
              type="button"
              className={`loc-suggestion ${i === activeIndex ? "loc-suggestion-active" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => select(loc)}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <MapPin size={12} />
              {loc}
            </button>
          ))}
        </div>
      )}
      {open && !loading && value.trim().length >= 2 && value.trim().toLowerCase() !== "remote" && suggestions.length === 0 && (
        <div className="loc-suggestions">
          <div className="loc-suggestion-empty">No matches found. You can still type any location.</div>
        </div>
      )}
    </div>
  );
}

const MAJORS = [
  "Accounting", "Actuarial Science", "Advertising", "Aerospace Engineering", "African American Studies",
  "African Studies", "Agribusiness", "Agricultural Engineering", "Agricultural Science", "Agronomy",
  "American Sign Language", "American Studies", "Animal Science", "Animation", "Anthropology",
  "Applied Mathematics", "Applied Physics", "Aquatic Science", "Archaeology", "Architecture",
  "Architectural Engineering", "Art", "Art Education", "Art History", "Arts Administration",
  "Asian Studies", "Astronomy", "Astrophysics", "Athletic Training", "Atmospheric Science",
  "Aviation", "Behavioral Science", "Biochemistry", "Bioengineering", "Bioinformatics",
  "Biology", "Biomedical Engineering", "Biomedical Science", "Biostatistics", "Botany",
  "Broadcast Journalism", "Business Administration", "Business Analytics", "Business Economics",
  "Chemical Engineering", "Chemistry", "Child Development", "Chinese", "Cinema Studies",
  "City Planning", "Civil Engineering", "Classics", "Clinical Laboratory Science",
  "Cognitive Science", "Communications", "Communication Disorders", "Comparative Literature",
  "Computer Engineering", "Computer Information Systems", "Computer Science", "Construction Management",
  "Corporate Communications", "Creative Writing", "Criminal Justice", "Criminology",
  "Culinary Arts", "Cybersecurity", "Dance", "Data Analytics", "Data Science", "Dentistry (Pre-Dental)",
  "Digital Media", "Early Childhood Education", "Earth Science", "East Asian Studies", "Ecology",
  "Economics", "Education", "Educational Psychology", "Electrical Engineering",
  "Elementary Education", "Emergency Management", "Engineering Management", "Engineering Physics",
  "English", "English Education", "Entomology", "Entrepreneurship", "Environmental Engineering",
  "Environmental Health", "Environmental Science", "Environmental Studies", "Epidemiology",
  "Equine Studies", "Ethnic Studies", "Event Management", "Exercise Science", "Fashion Design",
  "Fashion Merchandising", "Film Production", "Film Studies", "Finance", "Fine Arts",
  "Fire Science", "Food Science", "Forensic Accounting", "Forensic Science", "Forestry",
  "French", "Game Design", "Gender Studies", "Genetics", "Geography", "Geology",
  "Geophysics", "German", "Global Studies", "Government", "Graphic Design",
  "Health Administration", "Health Education", "Health Information Management", "Health Sciences",
  "Hearing Sciences", "History", "Horticulture", "Hospitality Management", "Human Development",
  "Human Resources", "Human Services", "Illustration", "Industrial Design", "Industrial Engineering",
  "Industrial-Organizational Psychology", "Information Science", "Information Systems",
  "Information Technology", "Interaction Design", "Interior Design", "International Affairs",
  "International Business", "International Relations", "International Studies", "Italian",
  "Japanese", "Jewish Studies", "Journalism", "Kinesiology", "Korean", "Labor Studies",
  "Landscape Architecture", "Latin", "Latin American Studies", "Law (Pre-Law)", "Legal Studies",
  "Liberal Arts", "Library Science", "Linguistics", "Logistics", "Management",
  "Management Information Systems", "Manufacturing Engineering", "Marine Biology",
  "Marine Science", "Marketing", "Materials Engineering", "Materials Science", "Mathematics",
  "Mathematics Education", "Mechanical Engineering", "Mechatronics Engineering", "Media Production",
  "Media Studies", "Medical Technology", "Medicine (Pre-Med)", "Meteorology", "Microbiology",
  "Middle Eastern Studies", "Molecular Biology", "Mortuary Science", "Music", "Music Business",
  "Music Composition", "Music Education", "Music Performance", "Music Therapy",
  "Native American Studies", "Natural Resources", "Naval Architecture", "Neuroscience",
  "Nuclear Engineering", "Nursing", "Nutrition Science", "Occupational Therapy",
  "Oceanography", "Operations Management", "Optometry (Pre-Optometry)", "Organizational Leadership",
  "Painting", "Paleontology", "Paralegal Studies", "Pathology", "Petroleum Engineering",
  "Pharmacy (Pre-Pharmacy)", "Philosophy", "Photography", "Physical Education", "Physical Therapy",
  "Physician Assistant Studies", "Physics", "Piano Performance", "Plant Science", "Playwriting",
  "Political Science", "Portuguese", "Poultry Science", "Pre-Veterinary Medicine",
  "Product Design", "Psychology", "Public Administration", "Public Health", "Public Policy",
  "Public Relations", "Radio, Television and Film", "Radiologic Technology", "Real Estate",
  "Recreation Management", "Religious Studies", "Renewable Energy", "Respiratory Therapy",
  "Risk Management", "Robotics Engineering", "Rural Studies", "Russian", "Screenwriting",
  "Sculpture", "Secondary Education", "Social Psychology", "Social Work", "Sociology",
  "Software Engineering", "Soil Science", "Sound Engineering", "South Asian Studies", "Spanish",
  "Special Education", "Speech Communication", "Speech-Language Pathology", "Sports Journalism",
  "Sports Management", "Sports Medicine", "Statistics", "Studio Art", "Supply Chain Management",
  "Surveying", "Sustainability Studies", "Systems Engineering", "Taxation", "Textile Design",
  "Theatre", "Theology", "Tourism Management", "Toxicology", "Translation Studies",
  "Transportation Engineering", "Urban Planning", "Urban Studies", "Veterinary Science (Pre-Vet)",
  "Video Game Development", "Video Production", "Vocal Performance", "Web Design",
  "Web Development", "Wildlife Biology", "Wildlife Management", "Women's Studies",
  "Writing", "Zoology",
];

function MajorInput({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapRef = React.useRef(null);

  const matches = useMemo(() => {
    const q = (value || "").trim().toLowerCase();
    if (!q) return [];
    return MAJORS.filter((m) => m.toLowerCase().includes(q)).slice(0, 6);
  }, [value]);

  useEffect(() => {
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const select = (m) => {
    onChange(m);
    setOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = (e) => {
    if (!open || matches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter") {
      if (activeIndex >= 0) {
        e.preventDefault();
        select(matches[activeIndex]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const highlight = (m) => {
    const q = (value || "").trim();
    if (!q) return m;
    const idx = m.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return m;
    return (
      <>
        {m.slice(0, idx)}
        <span className="loc-match">{m.slice(idx, idx + q.length)}</span>
        {m.slice(idx + q.length)}
      </>
    );
  };

  return (
    <div className="loc-wrap" ref={wrapRef}>
      <div className="input-with-icon">
        <GraduationCap size={13} />
        <input
          value={value}
          onChange={(e) => { onChange(e.target.value); setOpen(true); setActiveIndex(-1); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. Computer Science"
          autoComplete="off"
        />
      </div>
      {open && matches.length > 0 && (
        <div className="loc-suggestions">
          {matches.map((m, i) => (
            <button
              key={m}
              type="button"
              className={`loc-suggestion ${i === activeIndex ? "loc-suggestion-active" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => select(m)}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <GraduationCap size={12} />
              {highlight(m)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function QuickSaveModal({ draft, setDraft, onCancel, onSave, onSaveAndEdit }) {
  const canSave = draft.company.trim().length > 0;

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && canSave) {
      e.preventDefault();
      onSave();
    }
  };

  return (
    <div className="overlay" onClick={onCancel} onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}>
      <div className="qs-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="quicksave-modal-title">
        <div className="modal-head">
          <h2 id="quicksave-modal-title">Quick save</h2>
          <button className="icon-btn" onClick={onCancel} aria-label="Close"><X size={16} /></button>
        </div>

        <div className="qs-body">
          <p className="qs-hint">Jot it down now, fill in the rest later.</p>

          <label>
            Company <span className="req">*</span>
            <input
              value={draft.company}
              onChange={(e) => setDraft({ ...draft, company: e.target.value })}
              onKeyDown={handleKeyDown}
              placeholder="e.g. Under Armour"
              autoFocus
            />
          </label>

          <label>
            Listing link
            <div className="input-with-icon">
              <Link2 size={13} />
              <input
                value={draft.link}
                onChange={(e) => setDraft({ ...draft, link: e.target.value })}
                onKeyDown={handleKeyDown}
                placeholder="https://..."
              />
            </div>
          </label>
        </div>

        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-secondary" onClick={onSaveAndEdit} disabled={!canSave}>
            Save & add details
          </button>
          <button className="btn btn-primary" onClick={onSave} disabled={!canSave}>
            <Zap size={13} strokeWidth={2.4} />
            Quick save
          </button>
        </div>
      </div>
    </div>
  );
}

function EditModal({ draft, setDraft, onCancel, onSave }) {
  const set = (k) => (e) => setDraft({ ...draft, [k]: e.target.value });

  return (
    <div className="overlay" onClick={onCancel} onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="internship-modal-title">
        <div className="modal-head">
          <h2 id="internship-modal-title">{draft.id ? "Edit internship" : "Add internship"}</h2>
          <button className="icon-btn" onClick={onCancel} aria-label="Close"><X size={16} /></button>
        </div>

        <div className="modal-body">
          <div className="field-row">
            <label>
              Company <span className="req">*</span>
              <input value={draft.company} onChange={set("company")} placeholder="e.g. Under Armour" autoFocus maxLength={150} />
            </label>
            <label>
              Role / title
              <input value={draft.jobTitle} onChange={set("jobTitle")} placeholder="e.g. Assurance Intern" />
            </label>
          </div>

          <div className="field-row">
            <label>
              Status
              <select value={draft.status} onChange={set("status")}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label>
              Work type
              <select value={draft.workType} onChange={set("workType")}>
                {WORK_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>

          <div className="field-row">
            <label>
              Location
              <LocationInput
                value={draft.location}
                onChange={(v) => setDraft({ ...draft, location: v })}
              />
            </label>
            <label>
              Interest level
              <select value={draft.interest} onChange={set("interest")}>
                {INTEREST_LEVELS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>

          <div className="field-row">
            <label>
              Application deadline
              <input type="date" value={draft.deadline} onChange={set("deadline")} />
            </label>
            <label>
              Date applied
              <input type="date" value={draft.dateApplied} onChange={set("dateApplied")} />
            </label>
          </div>

          <div className="field-row">
            <label>
              Hourly rate ($)
              <input value={draft.hourlyRate} onChange={set("hourlyRate")} placeholder="e.g. 22" inputMode="decimal" />
            </label>
            <label>
              Salary (if not hourly)
              <input value={draft.salary} onChange={set("salary")} placeholder="e.g. $5,000/summer" />
            </label>
          </div>

          <label className="field-full">
            Listing link
            <div className="input-with-icon">
              <Link2 size={13} />
              <input value={draft.link} onChange={set("link")} placeholder="https://..." />
            </div>
          </label>

          <label className="field-full">
            Notes
            <textarea value={draft.notes} onChange={set("notes")} rows={3} placeholder="Contacts, interview prep, follow-ups…" />
          </label>

          <div className="field-full">
            <span className="section-label">Interview rounds</span>
            <InterviewsEditor
              interviews={draft.interviews || []}
              onChange={(next) => setDraft({ ...draft, interviews: next })}
            />
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={onSave} disabled={!draft.company.trim()}>
            {draft.id ? "Save changes" : "Add internship"}
          </button>
        </div>
      </div>
    </div>
  );
}

function InterviewsEditor({ interviews, onChange }) {
  const [form, setForm] = useState(emptyInterview());
  const [adding, setAdding] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const addRound = () => {
    if (!form.date) return;
    onChange([...interviews, { ...form, id: uid() }]);
    setForm(emptyInterview());
    setAdding(false);
  };

  const removeRound = (id) => onChange(interviews.filter((iv) => iv.id !== id));

  const sorted = [...interviews].sort((a, b) => {
    const da = interviewDateTime(a) || new Date("9999-12-31");
    const db = interviewDateTime(b) || new Date("9999-12-31");
    return da - db;
  });

  return (
    <div className="iv-editor">
      {sorted.length > 0 && (
        <div className="iv-list">
          {sorted.map((iv) => (
            <div className="iv-row" key={iv.id}>
              <div className="iv-row-icon"><InterviewTypeIcon type={iv.type} size={13} /></div>
              <div className="iv-row-body">
                <div className="iv-row-top">
                  <span className="iv-row-date">
                    {formatInterviewDate(iv.date)}{iv.time ? ` · ${formatInterviewTime(iv.time)}` : ""}
                  </span>
                  <span className="iv-row-type">{iv.type}</span>
                </div>
                {iv.location && (
                  isUrl(iv.location) ? (
                    <a className="iv-row-link" href={iv.location} target="_blank" rel="noopener noreferrer">
                      <Link2 size={11} />{iv.location}
                    </a>
                  ) : (
                    <span className="iv-row-loc"><MapPin size={11} />{iv.location}</span>
                  )
                )}
                {iv.notes && <span className="iv-row-notes">{iv.notes}</span>}
              </div>
              <button className="icon-btn" onClick={() => removeRound(iv.id)} aria-label="Remove round" title="Remove round">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {adding ? (
        <div className="iv-add-form">
          <div className="field-row">
            <label>
              Date
              <input type="date" value={form.date} onChange={set("date")} />
            </label>
            <label>
              Time
              <input type="time" value={form.time} onChange={set("time")} />
            </label>
          </div>
          <div className="field-row">
            <label>
              Type
              <select value={form.type} onChange={set("type")}>
                {INTERVIEW_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label>
              Zoom link / location
              <input
                value={form.location}
                onChange={set("location")}
                placeholder={form.type === "In-Person" ? "Address" : "https://zoom.us/..."}
              />
            </label>
          </div>
          <label className="field-full">
            Notes
            <input value={form.notes} onChange={set("notes")} placeholder="Interviewer name, what to prepare…" />
          </label>
          <div className="iv-add-actions">
            <button className="btn btn-ghost" onClick={() => { setAdding(false); setForm(emptyInterview()); }}>
              Cancel
            </button>
            <button className="btn btn-secondary" onClick={addRound} disabled={!form.date}>
              Add round
            </button>
          </div>
        </div>
      ) : (
        <button className="iv-add-trigger" onClick={() => setAdding(true)}>
          <Plus size={13} />
          Add interview round
        </button>
      )}
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..700;1,9..144,400..600&family=Inter:wght@400;500;600;700;800&display=swap');

.internly-root {
  --coral: #EA6B54;
  --pink: #E85D84;
  --peach: #F5BC6D;
  --cream: #FFF9F5;
  --ink: #3A2432;
  --ink-soft: #7A6470;
  --gold: #FFC857;
  --line: #F2E4DD;
  --card-bg: #FFFFFF;
  font-family: 'Inter', sans-serif;
  background: var(--cream);
  color: var(--ink);
  min-height: 100vh;
  border-radius: 16px;
  overflow: hidden;
  position: relative;
}

.internly-root * { box-sizing: border-box; }

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 24px;
  background: linear-gradient(120deg, var(--pink) 0%, var(--coral) 55%, var(--peach) 100%);
  position: relative;
}
.topbar::after {
  content: "";
  position: absolute; inset: 0;
  background: radial-gradient(140px 90px at 85% -20%, rgba(255,255,255,.35), transparent 70%);
  pointer-events: none;
}

.header-actions { display: flex; align-items: center; gap: 10px; position: relative; z-index: 1; flex-wrap: wrap; min-width: 0; }
.view-tabs {
  display: flex; align-items: center; gap: 2px;
  background: rgba(255,255,255,0.22);
  border: 1px solid rgba(255,255,255,0.35);
  border-radius: 10px;
  padding: 3px;
  max-width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.view-tabs::-webkit-scrollbar { display: none; }
.view-tab {
  display: flex; align-items: center; gap: 6px;
  border: none; background: rgba(255,255,255,0.65);
  color: #4A2438;
  font-size: 12.5px; font-weight: 700;
  padding: 6px 11px; border-radius: 8px;
  cursor: pointer;
  font-family: 'Inter', sans-serif;
  flex: 0 0 auto;
  white-space: nowrap;
}
.view-tab-active { background: #fff; color: var(--pink); }
.view-tabs-divider { width: 1px; height: 18px; background: rgba(255,255,255,0.5); margin: 0 2px; }

.subnav {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 24px;
  background: #fff;
  border-bottom: 1px solid var(--line);
  flex-wrap: wrap;
}
.subnav-tabs { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.subnav-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.subnav-actions .btn-quick {
  background: var(--cream); color: var(--coral); border: 1px solid var(--line);
}
.subnav-actions .btn-quick:hover { background: #FFF1EC; }
.subnav-tab {
  display: inline-flex; align-items: center; gap: 6px;
  border: none; background: transparent;
  color: var(--ink-soft); font-size: 12.5px; font-weight: 700;
  padding: 6px 12px; border-radius: 999px; cursor: pointer;
}
.subnav-tab:hover { background: var(--cream); color: var(--ink); }
.subnav-tab-active { background: var(--cream); color: var(--coral); }

.brand { display: flex; align-items: center; gap: 12px; }
.brand-text { display: flex; flex-direction: column; line-height: 1.15; }
.brand-name {
  font-family: 'Fraunces', serif;
  font-style: italic;
  font-weight: 600;
  font-size: 24px;
  color: #fff;
  letter-spacing: -0.01em;
}
.brand-tag {
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #2A1220;
  font-weight: 700;
}

.logo-mark {
  position: relative;
  border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 3px 10px rgba(150, 30, 60, 0.35);
  flex-shrink: 0;
  overflow: hidden;
  transform-style: preserve-3d;
  animation: logoFloat 5s ease-in-out infinite;
  transition: transform .2s ease, box-shadow .2s ease;
}
.logo-mark:hover {
  transform: perspective(300px) rotateY(10deg) rotateX(-6deg) scale(1.06);
  box-shadow: 0 8px 20px rgba(150, 30, 60, 0.4);
  animation-play-state: paused;
}
@keyframes logoFloat {
  0%, 100% { transform: translateY(0) rotateZ(0deg); }
  50% { transform: translateY(-2px) rotateZ(-2deg); }
}
.logo-img {
  width: 100%; height: 100%;
  object-fit: cover;
  border-radius: 10px;
  display: block;
}

.btn {
  display: inline-flex; align-items: center; gap: 6px;
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: 13.5px;
  border: none;
  border-radius: 10px;
  padding: 9px 15px;
  cursor: pointer;
  transition: transform .12s ease, box-shadow .12s ease, opacity .12s ease;
}
.btn:active { transform: translateY(1px); }
.btn-primary {
  background: #fff;
  color: var(--pink);
  box-shadow: 0 2px 8px rgba(0,0,0,0.12);
}
.btn-primary:hover { box-shadow: 0 4px 14px rgba(0,0,0,0.18); }
.btn-primary:disabled { opacity: .5; cursor: not-allowed; }
.btn-secondary {
  background: var(--ink);
  color: #fff;
}
.btn-secondary:disabled { opacity: .4; cursor: not-allowed; }
.btn-ghost {
  background: transparent;
  color: var(--ink-soft);
  border: 1px solid var(--line);
}
.btn-danger {
  background: #FF5C5C;
  color: #fff;
}
.btn-quick {
  background: rgba(255,255,255,0.2);
  color: #fff;
  border: 1px solid rgba(255,255,255,0.4);
}
.btn-quick:hover { background: rgba(255,255,255,0.3); }

.content { padding: 22px 24px 32px; }

.content-inner { animation: contentFadeIn .38s cubic-bezier(.22,.9,.32,1); }
@keyframes contentFadeIn {
  from { opacity: 0; transform: translateY(10px) scale(.99); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.tilt-card {
  position: relative;
  transform-style: preserve-3d;
  transition: transform .18s ease-out, box-shadow .18s ease-out;
  will-change: transform;
}
.tilt-shine {
  position: absolute; inset: 0; border-radius: inherit;
  background: radial-gradient(circle at var(--shine-x, 50%) var(--shine-y, 50%), rgba(255,255,255,0.55), transparent 60%);
  opacity: 0; transition: opacity .2s ease;
  pointer-events: none;
}
.tilt-card:hover .tilt-shine { opacity: 1; }
.tilt-card-inner { display: contents; }

.loading-state {
  display: flex; align-items: center; gap: 10px;
  justify-content: center;
  padding: 60px 0;
  color: var(--ink-soft);
  font-size: 14px;
}
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.save-banner {
  background: #FFF1E9;
  border: 1px solid #FFD3B8;
  color: #B85C2E;
  font-size: 12.5px;
  padding: 8px 12px;
  border-radius: 8px;
  margin-bottom: 14px;
}

.stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}
.stat-card {
  background: var(--card-bg);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 14px;
  display: flex; align-items: center; gap: 10px;
  transition: transform .15s ease, box-shadow .15s ease;
}
.stat-card:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(58,36,50,0.08); }
.stat-icon {
  width: 34px; height: 34px;
  border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.stat-value { font-size: 20px; font-weight: 800; line-height: 1.1; font-family: 'Fraunces', serif; }
.stat-label { font-size: 11px; color: var(--ink-soft); font-weight: 500; }

.stats-page { padding-top: 2px; }
.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
}
.chart-card {
  background: var(--card-bg);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 16px 16px 6px;
}
.chart-card-full { grid-column: 1 / -1; }
.chart-card-head { margin-bottom: 4px; }
.chart-card-head h3 {
  font-family: 'Fraunces', serif;
  font-size: 15px; margin: 0 0 2px;
  font-weight: 600;
}
.chart-card-sub { font-size: 11px; color: var(--ink-soft); }
.chart-empty {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  justify-content: center; height: 220px; color: var(--ink-soft);
  font-size: 12px; text-align: center;
}
.chart-tooltip {
  background: #fff; border: 1px solid var(--line); border-radius: 8px;
  padding: 7px 10px; box-shadow: 0 6px 18px rgba(0,0,0,0.12);
}
.chart-tooltip-label { font-size: 11px; color: var(--ink-soft); font-weight: 600; }
.chart-tooltip-value { font-size: 13px; color: var(--ink); font-weight: 800; }
.legend-label { font-size: 11.5px; color: var(--ink); font-weight: 600; }

.empty-hint { font-size: 12px; color: var(--ink-soft); }

.section-label {
  display: block;
  font-size: 11.5px; font-weight: 700; color: var(--ink-soft);
  margin-bottom: 6px;
}

.iv-editor {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px;
  background: var(--cream);
}
.iv-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px; }
.iv-row {
  display: flex; gap: 8px; align-items: flex-start;
  background: #fff; border: 1px solid var(--line); border-radius: 9px;
  padding: 8px 9px;
}
.iv-row-icon {
  width: 24px; height: 24px; border-radius: 7px;
  background: #FFF3D6; color: #B8790C;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; margin-top: 1px;
}
.iv-row-body { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.iv-row-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.iv-row-date { font-size: 12.5px; font-weight: 700; color: var(--ink); }
.iv-row-type { font-size: 10.5px; font-weight: 700; color: var(--ink-soft); }
.iv-row-link, .iv-row-loc {
  display: flex; align-items: center; gap: 4px;
  font-size: 11.5px; color: var(--coral); word-break: break-all;
}
.iv-row-loc { color: var(--ink-soft); }
.iv-row-notes { font-size: 11.5px; color: var(--ink-soft); margin-top: 1px; }

.iv-add-trigger {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  width: 100%; border: 1.5px dashed var(--line); background: transparent;
  border-radius: 9px; padding: 9px; font-size: 12px; font-weight: 700;
  color: var(--ink-soft); cursor: pointer;
}
.iv-add-trigger:hover { border-color: var(--coral); color: var(--coral); }
.iv-add-form {
  background: #fff; border: 1px solid var(--line); border-radius: 9px;
  padding: 10px; display: flex; flex-direction: column; gap: 10px;
}
.iv-add-actions { display: flex; justify-content: flex-end; gap: 8px; }

.interviews-page { display: flex; flex-direction: column; gap: 22px; }
.iv-group-title {
  font-family: 'Fraunces', serif; font-size: 16px; font-weight: 600;
  margin: 0 0 10px;
}
.iv-group-empty {
  font-size: 12.5px; color: var(--ink-soft);
  border: 1.5px dashed var(--line); border-radius: 10px;
  padding: 16px; text-align: center;
}
.iv-cards { display: flex; flex-direction: column; gap: 10px; }
.iv-card {
  display: flex; align-items: flex-start; gap: 14px;
  background: var(--card-bg); border: 1px solid var(--line);
  border-radius: 12px; padding: 12px 14px;
}
.iv-card-muted { opacity: 0.7; }
.iv-card-date {
  display: flex; flex-direction: column; align-items: center;
  min-width: 62px; padding: 6px 4px;
  background: var(--cream); border-radius: 9px;
  flex-shrink: 0;
}
.iv-card-day { font-size: 11px; font-weight: 800; color: var(--ink); text-align: center; line-height: 1.25; }
.iv-card-time { font-size: 10.5px; color: var(--ink-soft); font-weight: 600; }
.iv-card-main { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
.iv-card-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.iv-card-company { font-weight: 700; font-size: 13.5px; }
.iv-card-type {
  display: flex; align-items: center; gap: 4px;
  font-size: 10.5px; font-weight: 700; color: #B8790C;
  background: #FFF3D6; padding: 2px 7px; border-radius: 999px;
}
.iv-card-role { font-size: 12px; color: var(--ink-soft); }
.iv-card-link, .iv-card-loc {
  display: flex; align-items: center; gap: 4px;
  font-size: 12px; margin-top: 2px;
}
.iv-card-link { color: var(--coral); font-weight: 600; }
.iv-card-loc { color: var(--ink-soft); }
.iv-card-notes { font-size: 11.5px; color: var(--ink-soft); margin-top: 2px; font-style: italic; }
.iv-card-edit { flex-shrink: 0; padding: 6px 10px; font-size: 11.5px; }

.settings-page { display: flex; flex-direction: column; gap: 22px; }
.settings-section {
  background: var(--card-bg);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 18px;
}
.settings-section-danger { border-color: #F3C6C6; }
.settings-title { font-family: 'Fraunces', serif; font-size: 16px; font-weight: 600; margin: 0 0 3px; }
.settings-sub { font-size: 12.5px; color: var(--ink-soft); margin: 0 0 16px; }

.logo-picker { display: flex; gap: 16px; flex-wrap: wrap; }
.logo-option {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  border: none; background: transparent; cursor: pointer; padding: 0;
  width: 96px;
}
.logo-option-img {
  position: relative;
  width: 88px; height: 88px;
  border-radius: 18px;
  overflow: hidden;
  border: 2.5px solid transparent;
  box-shadow: 0 2px 8px rgba(58,36,50,0.1);
  transition: border-color .12s ease, transform .12s ease;
}
.logo-option-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.logo-option:hover .logo-option-img { transform: translateY(-2px); }
.logo-option-active .logo-option-img { border-color: var(--coral); }
.logo-option-check {
  position: absolute; bottom: 5px; right: 5px;
  width: 20px; height: 20px; border-radius: 50%;
  background: var(--coral); color: #fff;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 1px 4px rgba(0,0,0,0.25);
}
.logo-option-label { font-size: 11.5px; font-weight: 600; color: var(--ink-soft); text-align: center; }
.logo-option-active .logo-option-label { color: var(--ink); }

.academics-page { display: flex; flex-direction: column; gap: 18px; }
.academics-stats-row-4 { grid-template-columns: repeat(4, 1fr); }
.dashboard-stats-row-3 { grid-template-columns: repeat(3, 1fr); }

.gpa-sync-banner {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  background: #FFF3ED; border: 1px solid #FFD9C4; border-radius: 12px;
  padding: 12px 16px; flex-wrap: wrap;
}
.gpa-sync-banner span { font-size: 12.5px; color: var(--ink); }

.academics-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }

.grad-progress { margin-bottom: 14px; }
.grad-progress-track {
  width: 100%; height: 8px; border-radius: 999px;
  background: var(--cream); overflow: hidden; margin-bottom: 6px;
}
.grad-progress-fill {
  height: 100%; border-radius: 999px;
  background: linear-gradient(90deg, var(--pink), var(--coral));
  transition: width .2s ease;
}
.grad-progress-label { font-size: 11.5px; color: var(--ink-soft); font-weight: 600; }

.grad-config-toggle { padding: 6px 0 0; }
.grad-config-label { margin: 0; }

.whatif-result {
  background: var(--cream); border-radius: 10px; padding: 12px;
  margin-top: 4px;
}
.whatif-value { font-size: 13px; color: var(--ink); }
.whatif-value-hard { color: #D8393F; font-weight: 600; }
.whatif-value-easy { color: #268A4E; font-weight: 600; }

.category-table { display: flex; flex-direction: column; gap: 6px; }
.category-row {
  display: grid; grid-template-columns: 1fr 90px 90px;
  gap: 8px; padding: 6px 2px; font-size: 12.5px; color: var(--ink);
}
.category-row-head span {
  font-size: 10px; font-weight: 700; color: var(--ink-soft);
  text-transform: uppercase; letter-spacing: 0.03em;
}
.category-row:not(.category-row-head) { border-top: 1px solid var(--line); padding-top: 8px; }

.grade-scale-table { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; max-width: 340px; }
.grade-scale-row {
  display: grid; grid-template-columns: 1fr 1fr 26px;
  gap: 8px; align-items: center;
}
.grade-scale-row-head span {
  font-size: 10px; font-weight: 700; color: var(--ink-soft);
  text-transform: uppercase; letter-spacing: 0.03em;
}
.grade-scale-row input {
  font-family: 'Inter', sans-serif;
  border: 1px solid var(--line); border-radius: 7px;
  padding: 6px 8px; font-size: 12.5px; color: var(--ink);
  outline: none; background: #fff; width: 100%;
}
.grade-scale-row input:focus { border-color: var(--coral); }
.grade-scale-actions { max-width: 340px; margin-bottom: 4px; }

.collapsible-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  width: 100%; background: none; border: none; padding: 0; margin-bottom: 0;
  cursor: pointer; text-align: left;
}
.collapsible-head-text { display: flex; flex-direction: column; }
.collapsible-head .settings-sub { margin: 0; }
.collapsible-chevron { color: var(--ink-soft); flex-shrink: 0; transition: transform .15s ease; }
.collapsible-chevron-open { transform: rotate(180deg); }

.semesters-list { display: flex; flex-direction: column; gap: 12px; }

.semester-card {
  background: var(--card-bg); border: 1px solid var(--line);
  border-radius: 14px; padding: 14px 16px;
}
.semester-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px; flex-wrap: wrap; margin-bottom: 8px;
}
.semester-head-toggle {
  display: flex; align-items: center; gap: 8px;
  background: none; border: none; padding: 0; margin: 0;
  cursor: pointer; text-align: left; flex: 1; min-width: 0;
}
.semester-head-left { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.semester-name { font-family: 'Fraunces', serif; font-size: 15px; font-weight: 600; }
.semester-gpa-badge {
  font-size: 11px; font-weight: 700; color: var(--coral);
  background: #FFF1EC; padding: 3px 9px; border-radius: 999px;
}
.semester-gpa-badge-goal { color: #B8790C; background: #FFF3D6; }
.semester-credits { font-size: 11.5px; color: var(--ink-soft); }
.deans-list-badge {
  font-size: 11px; font-weight: 700; color: #B8790C;
  background: #FFF3D6; padding: 3px 9px; border-radius: 999px;
}
.semester-delete-confirm { display: flex; gap: 6px; }
.semester-head-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }

.course-table { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; overflow-x: auto; }
.course-row {
  display: grid; grid-template-columns: 90px 1.4fr 64px 100px 74px 74px 26px;
  gap: 6px; align-items: center; min-width: 620px;
}
.course-row-head span {
  font-size: 10px; font-weight: 700; color: var(--ink-soft);
  text-transform: uppercase; letter-spacing: 0.03em;
}
.course-row input, .course-row select {
  font-family: 'Inter', sans-serif;
  border: 1px solid var(--line); border-radius: 7px;
  padding: 6px 7px; font-size: 12px; color: var(--ink);
  outline: none; background: #fff; width: 100%;
}
.course-row input:focus, .course-row select:focus { border-color: var(--coral); }

.course-add-trigger {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  width: 100%; border: 1.5px dashed var(--line); background: transparent;
  border-radius: 8px; padding: 7px; font-size: 11.5px; font-weight: 700;
  color: var(--ink-soft); cursor: pointer;
}
.course-add-trigger:hover { border-color: var(--coral); color: var(--coral); }

.semester-add-form {
  background: var(--card-bg); border: 1px solid var(--line);
  border-radius: 14px; padding: 14px 16px;
  display: flex; flex-direction: column; gap: 10px;
}
.semester-add-form input {
  font-family: 'Inter', sans-serif;
  border: 1px solid var(--line); border-radius: 8px;
  padding: 8px 10px; font-size: 13px; color: var(--ink);
  outline: none;
}
.semester-add-form input:focus { border-color: var(--coral); }
.semester-add-actions { display: flex; justify-content: flex-end; gap: 8px; }
.academics-add-semester { padding: 14px; }

@media (max-width: 900px) {
  .academics-grid { grid-template-columns: 1fr; }
}

@media (max-width: 700px) {
  .academics-stats-row-4 { grid-template-columns: repeat(2, 1fr); }
  .dashboard-stats-row-3 { grid-template-columns: 1fr; }
}

.aura-stage {
  position: relative;
  overflow: hidden;
  border-radius: 18px;
  min-height: max(340px, calc(100vh - 300px));
  background: linear-gradient(160deg, #FFF3ED 0%, #FFEADD 100%);
  border: 1px solid var(--line);
  display: flex; align-items: center; justify-content: center;
  --mx: 50%; --my: 38%;
}
.aura-stage-tall { min-height: auto; }
.aura-blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(46px);
  transform: translate(var(--px, 0px), var(--py, 0px));
  transition: transform .15s ease-out;
  pointer-events: none;
  will-change: transform, top, left;
}
.aura-blob-1 {
  width: 260px; height: 260px;
  background: var(--pink);
  opacity: 0.55;
  animation: auraDrift1 16s ease-in-out infinite alternate;
}
.aura-blob-2 {
  width: 300px; height: 300px;
  background: var(--coral);
  opacity: 0.5;
  animation: auraDrift2 20s ease-in-out infinite alternate;
}
.aura-blob-3 {
  width: 220px; height: 220px;
  background: var(--peach);
  opacity: 0.55;
  animation: auraDrift3 18s ease-in-out infinite alternate;
}
.aura-blob-4 {
  width: 180px; height: 180px;
  background: var(--gold);
  opacity: 0.45;
  animation: auraDrift4 13s ease-in-out infinite alternate;
}
@keyframes auraDrift1 { from { top: 8%;  left: 6%;  } to { top: 20%; left: 18%; } }
@keyframes auraDrift2 { from { top: 26%; left: 52%; } to { top: 42%; left: 66%; } }
@keyframes auraDrift3 { from { top: 52%; left: 16%; } to { top: 64%; left: 30%; } }
@keyframes auraDrift4 { from { top: 4%;  left: 58%; } to { top: 16%; left: 72%; } }

.aura-glow {
  position: absolute; inset: 0;
  background: radial-gradient(circle at var(--mx) var(--my), rgba(255,255,255,0.6), transparent 55%);
  pointer-events: none;
}

.aura-content {
  position: relative; z-index: 2;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  text-align: center; padding: 20px;
}

.welcome-stage {
  min-height: 100vh;
  display: flex; align-items: center; justify-content: center;
  padding: 40px 20px;
}
.aura-content-welcome {
  align-items: center; text-align: center; width: 100%; max-width: 720px;
  padding: 36px 28px; gap: 8px;
}
.welcome-brand { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
.welcome-brand-name {
  font-family: 'Fraunces', serif; font-style: italic; font-weight: 600;
  font-size: 24px; color: var(--ink);
}
.welcome-title {
  font-family: 'Fraunces', serif; font-size: 26px; font-weight: 600;
  color: var(--ink); margin: 4px 0 0; text-align: center; line-height: 1.25;
}
.welcome-sub {
  font-size: 13.5px; color: var(--ink-soft); text-align: center;
  max-width: 480px; margin: 0 0 4px;
}
.welcome-feature-grid { width: 100%; margin: 12px 0 6px; text-align: left; }
.welcome-cta { margin-top: 8px; padding: 11px 24px; font-size: 14px; }
.welcome-login-link { margin-top: 4px; }
.aura-icon {
  width: 46px; height: 46px; border-radius: 14px;
  background: rgba(255,255,255,0.75);
  display: flex; align-items: center; justify-content: center;
  color: var(--coral);
  box-shadow: 0 4px 16px rgba(58,36,50,0.12);
  margin-bottom: 6px;
  transition: transform .2s ease;
}
.aura-stage:hover .aura-icon { transform: scale(1.08) rotate(-4deg); }
.aura-title { font-family: 'Fraunces', serif; font-size: 16px; font-weight: 600; color: var(--ink); margin: 0; }
.aura-hint { font-size: 12.5px; color: var(--ink-soft); max-width: 260px; }

.scholarships-page { display: flex; flex-direction: column; gap: 4px; }
.scholarships-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}
.scholarships-add-btn { flex-shrink: 0; white-space: nowrap; }

.dashboard-page { display: flex; flex-direction: column; gap: 18px; }
.dashboard-welcome { padding: 2px 2px 4px; }
.dashboard-welcome-title {
  font-family: 'Fraunces', serif; font-size: 22px; font-weight: 600;
  margin: 0 0 4px;
}
.dashboard-welcome-sub { font-size: 13px; color: var(--ink-soft); margin: 0; }

.dashboard-nav-cards {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
}
.dashboard-nav-card {
  display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
  background: var(--card-bg); border: 1px solid var(--line);
  border-radius: 14px; padding: 16px; text-align: left; cursor: pointer;
  transition: box-shadow .12s ease, border-color .12s ease;
}
.dashboard-nav-card:hover { box-shadow: 0 4px 16px rgba(58,36,50,0.08); border-color: #EAD8CE; }
.dashboard-nav-icon {
  width: 36px; height: 36px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 2px;
}
.dashboard-nav-title { font-family: 'Fraunces', serif; font-size: 15px; font-weight: 600; color: var(--ink); }
.dashboard-nav-detail { font-size: 12px; color: var(--ink-soft); }
.dashboard-nav-go {
  display: flex; align-items: center; gap: 4px;
  font-size: 11.5px; font-weight: 700; color: var(--coral);
  margin-top: 4px;
}

.feature-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
}
.feature-card {
  display: flex; flex-direction: column; gap: 5px;
  background: rgba(255,255,255,0.72);
  backdrop-filter: blur(6px);
  border: 1px solid rgba(255,255,255,0.6);
  border-radius: 12px; padding: 12px 14px;
  transition: transform .15s ease, background .15s ease;
}
.feature-card:hover { background: rgba(255,255,255,0.88); transform: translateY(-1px); }
.feature-icon {
  width: 28px; height: 28px; border-radius: 8px;
  background: #fff; color: var(--coral);
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 2px;
}
.feature-title { font-size: 12.5px; font-weight: 700; color: var(--ink); }
.feature-text { font-size: 11.5px; color: var(--ink-soft); line-height: 1.4; }

.games-page { display: flex; flex-direction: column; gap: 22px; }
.games-section { display: flex; flex-direction: column; gap: 10px; }
.games-section-title {
  display: flex; align-items: center; gap: 6px;
  font-family: 'Fraunces', serif; font-size: 14px; font-weight: 600;
  color: var(--ink); margin: 0;
}
.games-section-title svg { color: var(--gold); }
.games-section-empty { font-size: 12.5px; color: var(--ink-soft); margin: 0; }
.games-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
}
.game-card {
  position: relative;
  display: flex; flex-direction: column; gap: 6px;
  background: var(--card-bg); border: 1px solid var(--line);
  border-radius: 14px; padding: 16px;
  text-decoration: none; color: inherit;
  transition: box-shadow .12s ease, border-color .12s ease, transform .12s ease;
}
.game-card:hover { box-shadow: 0 4px 16px rgba(58,36,50,0.08); border-color: #EAD8CE; transform: translateY(-1px); }
.game-favorite {
  position: absolute; top: 12px; right: 12px; z-index: 2;
  border: none; background: rgba(255,255,255,0.85);
  width: 28px; height: 28px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  color: var(--ink-soft); cursor: pointer;
  transition: color .12s ease, transform .12s ease;
}
.game-favorite:hover { color: var(--gold); transform: scale(1.1); }
.game-favorite-active { color: var(--gold); }
.game-icon {
  width: 36px; height: 36px; border-radius: 10px;
  background: linear-gradient(135deg, var(--pink), var(--coral));
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 2px;
}
.game-title { font-family: 'Fraunces', serif; font-size: 15px; font-weight: 600; color: var(--ink); padding-right: 26px; }
.game-sponsor { font-size: 10.5px; font-weight: 700; color: var(--ink-soft); text-transform: uppercase; letter-spacing: 0.03em; }
.game-text { font-size: 12px; color: var(--ink-soft); line-height: 1.45; margin-top: 2px; }
.game-play {
  display: flex; align-items: center; gap: 5px;
  font-size: 11.5px; font-weight: 700; color: var(--coral);
  margin-top: 8px;
}

@media (max-width: 900px) {
  .dashboard-nav-cards { grid-template-columns: 1fr; }
  .feature-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 560px) {
  .feature-grid { grid-template-columns: 1fr; }
}

@media (max-width: 780px) {
  .stats-grid { grid-template-columns: 1fr; }
  .iv-card { flex-wrap: wrap; }
}

.controls-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}
.search-box {
  display: flex; align-items: center; gap: 7px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 8px 12px;
  min-width: 220px;
  color: var(--ink-soft);
  flex: 1 1 220px;
}
.search-box input {
  border: none; outline: none; font-size: 13px; width: 100%;
  font-family: 'Inter', sans-serif; color: var(--ink);
  background: transparent;
}
.chip-filters { display: flex; gap: 6px; flex-wrap: wrap; }
.filter-chip {
  display: inline-flex; align-items: center; gap: 6px;
  border: 1px solid var(--line);
  background: #fff;
  color: var(--ink-soft);
  font-size: 12.5px;
  font-weight: 600;
  padding: 6px 11px;
  border-radius: 999px;
  cursor: pointer;
}
.filter-chip-active {
  background: var(--ink);
  border-color: var(--ink);
  color: #fff;
}
.chip-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; flex-shrink: 0; }

.sort-box {
  display: flex; align-items: center; gap: 6px;
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 10px;
  padding: 7px 10px;
  color: var(--ink-soft);
}
.sort-box select {
  border: none; outline: none; font-size: 12.5px; font-weight: 600;
  color: var(--ink); background: transparent; font-family: 'Inter', sans-serif;
}

.board {
  display: grid;
  grid-template-columns: repeat(5, minmax(220px, 1fr));
  gap: 14px;
  overflow-x: auto;
  padding-bottom: 8px;
}
.column { min-width: 0; }
.column-head {
  display: flex; align-items: center; gap: 7px;
  margin-bottom: 10px;
  padding: 0 2px;
}
.column-head h3 {
  font-size: 13px; font-weight: 700; margin: 0;
  font-family: 'Inter', sans-serif;
}
.column-count {
  margin-left: auto;
  font-size: 11px;
  color: var(--ink-soft);
  background: var(--line);
  padding: 1px 7px;
  border-radius: 999px;
  font-weight: 700;
}
.column-body { display: flex; flex-direction: column; gap: 10px; }

.empty-slot {
  border: 1.5px dashed var(--line);
  background: transparent;
  border-radius: 12px;
  padding: 16px 10px;
  color: var(--ink-soft);
  font-size: 12px;
  font-weight: 600;
  display: flex; align-items: center; justify-content: center; gap: 5px;
  cursor: pointer;
}
.empty-slot:hover { border-color: var(--coral); color: var(--coral); }

.list-view { display: flex; flex-direction: column; gap: 10px; }
.empty-state {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 50px 0; color: var(--ink-soft);
}

.card {
  background: var(--card-bg);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 13px;
  position: relative;
  cursor: pointer;
  transition: box-shadow .12s ease, border-color .12s ease;
}
.card:hover { box-shadow: 0 4px 16px rgba(58,36,50,0.08); border-color: #EAD8CE; }
.card-wide { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 10px; }
.card-wide .card-top { grid-column: 1; }
.card-wide .card-meta { grid-column: 1; margin-top: 4px; }
.card-wide .card-bottom { grid-column: 2; margin: 0; }
.card-wide .status-select { grid-column: 3; }

.card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 6px; }
.card-title { display: flex; flex-direction: column; min-width: 0; }
.card-company { font-weight: 700; font-size: 13.5px; }
.card-role { font-size: 12px; color: var(--ink-soft); }
.card-actions { display: flex; gap: 4px; opacity: 0.55; }
.card:hover .card-actions { opacity: 1; }
.icon-btn {
  border: none; background: transparent; color: var(--ink-soft);
  cursor: pointer; padding: 4px; border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
}
.icon-btn:hover { background: var(--cream); color: var(--ink); }

.card-meta { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; }
.meta-item { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--ink-soft); }

.card-bottom { display: flex; align-items: center; gap: 6px 8px; margin-top: 8px; flex-wrap: wrap; }

.chip {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 10.5px; font-weight: 700;
  padding: 3px 8px; border-radius: 999px;
}
.chip-ok { background: #EAF7EE; color: #268A4E; }
.chip-soon { background: #FFF4E0; color: #B8790C; }
.chip-urgent { background: #FFE7E7; color: #D8393F; }
.chip-past { background: #F1E9EE; color: #8A6A80; }
.chip-muted { background: var(--cream); color: var(--ink-soft); }
.chip-applied { background: #E9F2FF; color: #2A6DC9; }
.chip-interview { background: #FFF3D6; color: #B8790C; }

.interest-dots { display: inline-flex; gap: 3px; }
.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--line); display: inline-block; }
.dot-on { background: var(--gold); }

.link-btn {
  margin-left: auto;
  color: var(--coral);
  display: flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 6px;
}
.link-btn:hover { background: #FFF1EC; }

.status-select { position: relative; margin-top: 10px; }
.status-btn {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11.5px; font-weight: 700;
  border: 1px solid var(--line);
  background: var(--cream);
  padding: 5px 9px;
  border-radius: 8px;
  cursor: pointer;
  color: var(--ink);
  width: 100%;
  justify-content: space-between;
}
.status-menu {
  position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 5;
  background: #fff; border: 1px solid var(--line); border-radius: 10px;
  box-shadow: 0 6px 20px rgba(0,0,0,0.12);
  padding: 4px;
  display: flex; flex-direction: column;
}
.status-menu-item {
  display: flex; align-items: center; gap: 7px;
  border: none; background: transparent; text-align: left;
  padding: 7px 8px; border-radius: 7px; font-size: 12px; font-weight: 600;
  color: var(--ink); cursor: pointer;
}
.status-menu-item:hover { background: var(--cream); }

.overlay {
  position: fixed; inset: 0; background: rgba(58,36,50,0.45);
  display: flex; justify-content: center;
  z-index: 50; padding: 16px; backdrop-filter: blur(2px);
  overflow-y: auto;
}
.overlay > * { margin: auto 0; }
.modal {
  background: #fff; border-radius: 16px; width: 100%; max-width: 520px;
  max-height: 88vh; overflow-y: auto;
  box-shadow: 0 20px 60px rgba(0,0,0,0.25);
}
.qs-modal {
  background: #fff; border-radius: 16px; width: 100%; max-width: 400px;
  max-height: 88vh; overflow-y: auto;
  box-shadow: 0 20px 60px rgba(0,0,0,0.25);
}
.qs-body { padding: 16px 18px 6px; display: flex; flex-direction: column; gap: 14px; }
.qs-hint { font-size: 12px; color: var(--ink-soft); margin: -4px 0 0; }
.qs-body label {
  display: flex; flex-direction: column; gap: 5px;
  font-size: 11.5px; font-weight: 700; color: var(--ink-soft);
}
.qs-body input {
  font-family: 'Inter', sans-serif;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  color: var(--ink);
  font-weight: 500;
  outline: none;
  background: #fff;
}
.qs-body input:focus { border-color: var(--coral); }
.qs-body .input-with-icon { color: var(--ink-soft); }
.qs-body .input-with-icon input { border: none; padding: 8px 0; }
.modal-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 18px; border-bottom: 1px solid var(--line);
  position: sticky; top: 0; background: #fff; z-index: 1;
}
.modal-head h2 { font-family: 'Fraunces', serif; font-size: 18px; margin: 0; }
.modal-body { padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; }
.field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }
.modal label, .field-full, .settings-section label {
  display: flex; flex-direction: column; gap: 5px;
  font-size: 11.5px; font-weight: 700; color: var(--ink-soft);
}
.field-full { margin-bottom: 10px; }
.req { color: var(--coral); }
.modal input, .modal select, .modal textarea,
.settings-section input, .settings-section select, .settings-section textarea {
  font-family: 'Inter', sans-serif;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  color: var(--ink);
  font-weight: 500;
  outline: none;
  background: #fff;
}
.modal input:focus, .modal select:focus, .modal textarea:focus,
.settings-section input:focus, .settings-section select:focus { border-color: var(--coral); }
.settings-actions { display: flex; gap: 8px; margin-top: 12px; }

.toggle-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 9px 0; border-top: 1px solid var(--line);
  max-width: 480px;
}
.toggle-row:first-of-type { border-top: none; }
.toggle-row-text { display: flex; flex-direction: column; gap: 1px; }
.toggle-label { font-size: 12.5px; font-weight: 700; color: var(--ink); }
.toggle-desc { font-size: 11px; color: var(--ink-soft); }
.toggle-switch {
  width: 38px; height: 22px; border-radius: 999px;
  background: var(--line); border: none; padding: 2px; cursor: pointer;
  display: flex; align-items: center; flex-shrink: 0;
  transition: background .15s ease;
}
.toggle-switch-on { background: var(--coral); }
.toggle-knob {
  width: 18px; height: 18px; border-radius: 50%; background: #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  transition: transform .15s ease;
  display: block;
}
.toggle-switch-on .toggle-knob { transform: translateX(16px); }
.input-with-icon {
  display: flex; align-items: center; gap: 6px;
  border: 1px solid var(--line); border-radius: 8px; padding: 0 10px;
  color: var(--ink-soft);
}
.input-with-icon input { border: none; padding: 8px 0; flex: 1; }

.loc-wrap { position: relative; }
.loc-suggestions {
  position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 10;
  background: #fff; border: 1px solid var(--line); border-radius: 10px;
  box-shadow: 0 10px 26px rgba(0,0,0,0.14);
  padding: 4px; max-height: 210px; overflow-y: auto;
}
.loc-suggestion {
  display: flex; align-items: center; gap: 7px; width: 100%;
  border: none; background: transparent; text-align: left;
  padding: 7px 8px; border-radius: 7px; font-size: 12.5px; font-weight: 500;
  color: var(--ink); cursor: pointer;
}
.loc-suggestion svg { color: var(--ink-soft); flex-shrink: 0; }
.loc-suggestion-active { background: var(--cream); }
.loc-match { color: var(--coral); font-weight: 700; }
.loc-suggestion-empty { padding: 8px; font-size: 12px; color: var(--ink-soft); }
.input-with-icon .spin { color: var(--ink-soft); margin-left: auto; flex-shrink: 0; }
.modal-foot {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 14px 18px; border-top: 1px solid var(--line);
  position: sticky; bottom: 0; background: #fff;
  flex-wrap: wrap;
}

.qv-modal {
  background: #fff; border-radius: 16px; width: 100%; max-width: 460px;
  max-height: 88vh; overflow-y: auto;
  box-shadow: 0 20px 60px rgba(0,0,0,0.25);
}
.qv-head {
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: 18px 18px 6px;
}
.qv-company { font-family: 'Fraunces', serif; font-size: 19px; font-weight: 600; margin: 0; }
.qv-role { font-size: 13px; color: var(--ink-soft); margin-top: 2px; }

.qv-status-row {
  display: flex; flex-wrap: wrap; gap: 6px;
  padding: 10px 18px 4px;
}
.qv-status-pill {
  border: 1.5px solid var(--line); background: #fff;
  color: var(--ink-soft); font-size: 11px; font-weight: 700;
  padding: 5px 10px; border-radius: 999px; cursor: pointer;
}
.qv-status-pill-active { color: #fff; border-color: transparent; }

.qv-body { padding: 14px 18px 4px; display: flex; flex-direction: column; gap: 16px; }
.qv-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px;
}
.qv-field { display: flex; flex-direction: column; gap: 3px; }
.qv-field-label {
  display: flex; align-items: center; gap: 5px;
  font-size: 10.5px; font-weight: 700; color: var(--ink-soft);
  text-transform: uppercase; letter-spacing: 0.03em;
}
.qv-field-value { font-size: 13px; font-weight: 600; color: var(--ink); }
.qv-chips { display: flex; flex-wrap: wrap; gap: 8px; }

.qv-section { display: flex; flex-direction: column; gap: 8px; }
.qv-section-title {
  display: flex; align-items: center; gap: 5px;
  font-size: 11px; font-weight: 700; color: var(--ink-soft);
  text-transform: uppercase; letter-spacing: 0.03em;
}
.qv-interview {
  display: flex; gap: 9px; align-items: flex-start;
  background: var(--cream); border-radius: 10px; padding: 10px;
}
.qv-interview-muted { opacity: 0.75; }
.qv-interview-icon {
  width: 24px; height: 24px; border-radius: 7px;
  background: #FFF3D6; color: #B8790C;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.qv-interview-body { display: flex; flex-direction: column; gap: 2px; }
.qv-interview-date { font-size: 12.5px; font-weight: 700; color: var(--ink); }
.qv-notes {
  font-size: 12.5px; color: var(--ink); line-height: 1.5;
  background: var(--cream); border-radius: 10px; padding: 10px; margin: 0;
  white-space: pre-wrap;
}

.qv-course-row {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 7px 0; border-top: 1px solid var(--line);
  font-size: 12.5px;
}
.qv-course-row:first-child { border-top: none; }
.qv-course-name { font-weight: 600; color: var(--ink); flex: 1; min-width: 0; }
.qv-course-meta { color: var(--ink-soft); flex-shrink: 0; white-space: nowrap; }
.qv-course-grade { font-weight: 700; color: var(--coral); flex-shrink: 0; white-space: nowrap; }

.confirm-box {
  background: #fff; border-radius: 14px; padding: 18px; max-width: 320px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.25);
}
.confirm-box p { font-size: 13.5px; margin: 0 0 14px; color: var(--ink); }
.confirm-actions { display: flex; justify-content: flex-end; gap: 8px; }

@media (max-width: 1100px) {
  .stats-row { grid-template-columns: repeat(3, 1fr); }
}

@media (max-width: 900px) {
  .board { grid-template-columns: minmax(220px, 1fr); }
  .stats-row { grid-template-columns: repeat(2, 1fr); }
  .field-row { grid-template-columns: 1fr; }
  .card-wide { grid-template-columns: 1fr; }
  .card-wide .status-select { grid-column: 1; }
  .card-wide .card-bottom { grid-column: 1; }
  .stats-grid { grid-template-columns: 1fr; }
}

@media (max-width: 560px) {
  .topbar { flex-direction: column; align-items: flex-start; gap: 12px; }
  .header-actions { width: 100%; justify-content: space-between; }
  .subnav { padding: 10px 16px; }
  .subnav-actions { width: 100%; }
  .subnav-actions .btn { flex: 1; justify-content: center; }
}

.boot-loading {
  display: flex; align-items: center; justify-content: center;
  min-height: 100vh; color: var(--coral);
}

.auth-stage {
  min-height: 100vh;
  display: flex; align-items: center; justify-content: center;
  padding: 40px 20px;
  background: linear-gradient(150deg, var(--pink) 0%, var(--coral) 55%, var(--peach) 100%);
}
.auth-card {
  background: #fff;
  border-radius: 20px;
  width: 100%; max-width: 420px;
  padding: 26px 28px 24px;
  box-shadow: 0 24px 60px rgba(58,36,50,0.25);
  display: flex; flex-direction: column; gap: 14px;
  animation: authCardIn .4s cubic-bezier(.22,.9,.32,1);
}
@keyframes authCardIn {
  from { opacity: 0; transform: translateY(16px) scale(.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.auth-brand { display: flex; align-items: center; gap: 10px; justify-content: center; }
.auth-brand-name {
  font-family: 'Fraunces', serif; font-style: italic; font-weight: 600;
  font-size: 22px; color: var(--ink);
}
.auth-progress { display: flex; gap: 6px; justify-content: center; margin-bottom: 2px; }
.auth-dot { width: 22px; height: 4px; border-radius: 999px; background: var(--line); }
.auth-dot-active { background: var(--coral); }
.error-code {
  font-family: 'Fraunces', serif; font-weight: 700; font-size: 40px;
  text-align: center; line-height: 1;
  background: linear-gradient(90deg, var(--pink), var(--coral) 60%, var(--peach));
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.auth-title {
  font-family: 'Fraunces', serif; font-size: 20px; font-weight: 600;
  text-align: center; margin: 0;
}
.auth-sub { font-size: 12.5px; color: var(--ink-soft); text-align: center; margin: -8px 0 0; }
.auth-error {
  background: #FFEDED; color: #C23B3B; border: 1px solid #FFC9C9;
  font-size: 12px; font-weight: 600; padding: 8px 10px; border-radius: 8px;
}
.auth-field {
  display: flex; flex-direction: column; gap: 5px;
  font-size: 11.5px; font-weight: 700; color: var(--ink-soft);
}
.auth-field input, .auth-field select {
  font-family: 'Inter', sans-serif;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  color: var(--ink);
  font-weight: 500;
  outline: none;
  background: #fff;
  width: 100%;
}
.auth-field input:focus, .auth-field select:focus { border-color: var(--coral); }
.auth-field .input-with-icon input { border: none; padding: 8px 0; }
.password-input { position: relative; }
.password-toggle {
  border: none; background: transparent; cursor: pointer;
  color: var(--ink-soft); display: flex; align-items: center; justify-content: center;
  padding: 4px; margin-left: 4px; border-radius: 6px; flex-shrink: 0;
}
.password-toggle:hover { color: var(--coral); background: var(--cream); }
.auth-field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.auth-submit {
  width: 100%; justify-content: center; margin-top: 4px;
  padding: 10px 15px;
}
.auth-actions-row { display: flex; gap: 8px; margin-top: 4px; flex-wrap: wrap; }
.auth-actions-row .btn-primary { flex: 1; justify-content: center; }
.auth-actions-row .btn-ghost { flex: 0 0 auto; }
.auth-link {
  background: none; border: none; color: var(--ink-soft);
  font-size: 11.5px; font-weight: 600; text-decoration: underline;
  cursor: pointer; padding: 2px; align-self: center;
}
.auth-link:hover { color: var(--coral); }
.auth-disclaimer {
  font-size: 10.5px; color: var(--ink-soft); text-align: center;
  line-height: 1.5; margin: 6px 0 0; padding: 0 4px;
}
.auth-reset-confirm {
  background: #FFF3ED; border: 1px solid #FFD9C4; border-radius: 10px;
  padding: 10px; display: flex; flex-direction: column; gap: 8px;
  font-size: 11.5px; color: var(--ink); text-align: center;
}

/* ===== Accessibility utilities ===== */
.sr-only {
  position: absolute; width: 1px; height: 1px;
  padding: 0; margin: -1px; overflow: hidden;
  clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}
.skip-link {
  position: absolute; top: -100px; left: 8px; z-index: 1000;
  background: #fff; color: var(--ink); padding: 10px 16px;
  border-radius: 8px; font-weight: 700; font-size: 13px;
  text-decoration: none; transition: top 0.15s ease;
  box-shadow: 0 4px 14px rgba(0,0,0,0.25);
}
.skip-link:focus { top: 8px; }

/* A visible, consistent focus indicator for every interactive element.
   Several places removed the default outline in favor of just a border
   color change, which isn't enough contrast/visibility for a lot of low
   vision users - this restores a strong, uniform focus ring everywhere. */
a:focus-visible, button:focus-visible, input:focus-visible,
select:focus-visible, textarea:focus-visible, [tabindex]:focus-visible {
  outline: 2.5px solid #1A5FD1 !important;
  outline-offset: 2px !important;
}

/* ===== Mobile safety net ===== */
@media (max-width: 640px) {
  html, body { overflow-x: hidden; }
  .internly-root { min-width: 0; }

  /* Top header: stack brand above nav instead of squeezing them side by side */
  .topbar {
    flex-direction: column; align-items: stretch; gap: 10px;
    padding: 12px 14px;
  }
  .brand { justify-content: flex-start; }
  .brand-tag { display: none; } /* decorative tagline - drop it to save space on phones */
  .header-actions { width: 100%; flex-wrap: nowrap; }
  .view-tabs {
    width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch;
    flex-wrap: nowrap; justify-content: flex-start;
  }
  .view-tabs::-webkit-scrollbar { display: none; }
  .view-tab { flex: 0 0 auto; white-space: nowrap; padding: 7px 10px; font-size: 12px; }
  .view-tabs-divider { flex: 0 0 auto; }
  .subnav { padding: 8px 12px; }
  .subnav-tabs { overflow-x: auto; flex-wrap: nowrap; -webkit-overflow-scrolling: touch; }
  .subnav-tab { flex: 0 0 auto; white-space: nowrap; }

  .app-shell, .content, .content-inner, .page, .dashboard-page,
  .internships-page, .academics-page, .scholarships-page,
  .volunteering-page, .games-page, .settings-page {
    max-width: 100vw; padding-left: 12px; padding-right: 12px; box-sizing: border-box;
  }
  .top-nav, .app-nav, .nav-bar { flex-wrap: wrap; gap: 6px; padding: 8px 10px; }
  .nav-links { flex-wrap: wrap; gap: 4px; }
  .nav-link { padding: 6px 8px; font-size: 12px; }
  .stats-row, .stat-grid, .dashboard-stats { grid-template-columns: repeat(2, 1fr) !important; gap: 8px; }
  .charts-row, .dashboard-charts { grid-template-columns: 1fr !important; }
  .board {
    display: flex; overflow-x: auto; -webkit-overflow-scrolling: touch;
    scroll-snap-type: x mandatory; gap: 10px; grid-template-columns: none;
  }
  .column {
    min-width: 78vw; scroll-snap-align: start; flex: 0 0 auto;
  }
  .column-head { flex-wrap: nowrap; }
  .column-head h3 { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  table { display: block; overflow-x: auto; white-space: nowrap; -webkit-overflow-scrolling: touch; }
  .modal, .modal-card, .quick-view-modal {
    width: 100vw !important; max-width: 100vw !important; height: 100%;
    max-height: 100dvh; border-radius: 0; margin: 0; left: 0; top: 0; transform: none;
  }
  .modal-body { max-height: calc(100dvh - 140px); overflow-y: auto; }
  .auth-card { width: 100%; max-width: 100%; padding: 20px 16px; border-radius: 16px; }
  .auth-stage { padding: 16px; }
  .logo-picker { flex-wrap: wrap; justify-content: center; }
  .games-grid, .game-grid { grid-template-columns: repeat(2, 1fr) !important; }
  .settings-actions { flex-wrap: wrap; }
  input, select, textarea, button { font-size: 16px; } /* prevents iOS auto-zoom on focus */
  .btn, .btn-primary, .btn-ghost, .btn-danger, .btn-quick { min-height: 40px; }
  .icon-btn { min-width: 36px; min-height: 36px; }
}
@media (max-width: 400px) {
  .stats-row, .stat-grid, .dashboard-stats { grid-template-columns: 1fr !important; }
  .games-grid, .game-grid { grid-template-columns: 1fr !important; }
}
`;
