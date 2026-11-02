using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace TcAudioLoopbackWorker
{
    [StructLayout(LayoutKind.Sequential)]
    public struct AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS
    {
        public uint TargetProcessId;
        public uint ProcessLoopbackMode; // 0 = INCLUDE_TARGET_PROCESS_TREE, 1 = EXCLUDE_TARGET_PROCESS_TREE
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct AUDIOCLIENT_ACTIVATION_PARAMS
    {
        public uint ActivationType; // 1 = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK
        public AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS ProcessLoopbackParams;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct BLOB
    {
        public uint cbSize;
        public IntPtr pBlobData;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct PROPVARIANT
    {
        [FieldOffset(0)] public ushort vt;
        [FieldOffset(2)] public ushort wReserved1;
        [FieldOffset(4)] public ushort wReserved2;
        [FieldOffset(6)] public ushort wReserved3;
        [FieldOffset(8)] public BLOB blob;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct WAVEFORMATEX
    {
        public ushort wFormatTag;
        public ushort nChannels;
        public uint nSamplesPerSec;
        public uint nAvgBytesPerSec;
        public ushort nBlockAlign;
        public ushort wBitsPerSample;
        public ushort cbSize;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    public struct PROCESSENTRY32
    {
        public uint dwSize;
        public uint cntUsage;
        public uint th32ProcessID;
        public IntPtr th32DefaultHeapID;
        public uint th32ModuleID;
        public uint cntThreads;
        public uint th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szExeFile;
    }

    [ComImport]
    [Guid("94EA2B94-E9CC-49E0-C0FF-EE64CA8F5B90")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAgileObject { }

    [ComImport]
    [Guid("41D949AB-9862-444A-80F6-C261334DA588")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IActivateAudioInterfaceCompletionHandler
    {
        [PreserveSig]
        int ActivateCompleted(IntPtr activateOperation);
    }

    [ComImport]
    [Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioClient
    {
        [PreserveSig]
        int Initialize(int ShareMode, uint StreamFlags, long hnsBufferDuration, long hnsPeriodicity, ref WAVEFORMATEX pFormat, IntPtr AudioSessionGuid);
        [PreserveSig]
        int GetBufferSize(out uint pNumBufferFrames);
        [PreserveSig]
        int GetStreamLatency(out long phnsLatency);
        [PreserveSig]
        int GetCurrentPadding(out uint pNumPaddingFrames);
        [PreserveSig]
        int IsFormatSupported(int ShareMode, ref WAVEFORMATEX pFormat, IntPtr ppClosestMatch);
        [PreserveSig]
        int GetMixFormat(out IntPtr ppDeviceFormat);
        [PreserveSig]
        int GetDevicePeriod(out long phnsDefaultDevicePeriod, out long phnsMinimumDevicePeriod);
        [PreserveSig]
        int Start();
        [PreserveSig]
        int Stop();
        [PreserveSig]
        int Reset();
        [PreserveSig]
        int SetEventHandle(IntPtr eventHandle);
        [PreserveSig]
        int GetService([In] ref Guid riid, out IntPtr ppv);
    }

    [ComImport]
    [Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioCaptureClient
    {
        [PreserveSig]
        int GetBuffer(out IntPtr ppData, out uint pNumFramesToRead, out uint pdwFlags, out ulong pu64DevicePosition, out ulong pu64QPCPosition);
        [PreserveSig]
        int ReleaseBuffer(uint NumFramesRead);
        [PreserveSig]
        int GetNextPacketSize(out uint pNumFramesInNextPacket);
    }

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    public delegate int GetActivateResultDelegate(IntPtr thisPtr, out int activateResult, out IntPtr activatedInterface);

    [ComVisible(true)]
    [ClassInterface(ClassInterfaceType.None)]
    public class ActivateHandler : IActivateAudioInterfaceCompletionHandler, IAgileObject
    {
        public ManualResetEvent DoneEvent = new ManualResetEvent(false);
        public int ActivateHr = -1;
        public IntPtr AudioClientPtr = IntPtr.Zero;

        public int ActivateCompleted(IntPtr activateOperation)
        {
            try
            {
                IntPtr vtable = Marshal.ReadIntPtr(activateOperation);
                IntPtr fnPtr = Marshal.ReadIntPtr(vtable, 3 * IntPtr.Size);
                var fn = (GetActivateResultDelegate)Marshal.GetDelegateForFunctionPointer(fnPtr, typeof(GetActivateResultDelegate));
                fn(activateOperation, out ActivateHr, out AudioClientPtr);
            }
            catch { }
            DoneEvent.Set();
            return 0;
        }
    }

    class Program
    {
        [DllImport("mmdevapi.dll", ExactSpelling = true, PreserveSig = true)]
        static extern int ActivateAudioInterfaceAsync(
            [MarshalAs(UnmanagedType.LPWStr)] string deviceInterfacePath,
            [In] ref Guid riid,
            ref PROPVARIANT activationParams,
            IActivateAudioInterfaceCompletionHandler completionHandler,
            out IntPtr activationOperation
        );

        [DllImport("user32.dll")]
        static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        static extern IntPtr GetAncestor(IntPtr hwnd, uint gaFlags);

        [DllImport("user32.dll")]
        static extern IntPtr GetTopWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);

        [DllImport("user32.dll")]
        static extern int GetWindowLong(IntPtr hWnd, int nIndex);

        [DllImport("user32.dll")]
        static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll")]
        static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

        [DllImport("user32.dll")]
        static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

        [DllImport("dwmapi.dll")]
        static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out int pvAttribute, int cbAttribute);

        delegate bool EnumWindowProc(IntPtr hwnd, IntPtr lParam);

        [DllImport("user32.dll")]
        static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowProc lpEnumFunc, IntPtr lParam);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        static extern IntPtr CreateToolhelp32Snapshot(uint dwFlags, uint th32ProcessID);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        static extern bool Process32First(IntPtr hSnapshot, ref PROCESSENTRY32 lppe);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        static extern bool Process32Next(IntPtr hSnapshot, ref PROCESSENTRY32 lppe);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool CloseHandle(IntPtr hObject);

        static readonly HashSet<string> IgnoredProcesses = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "discord.exe", "discordptb.exe", "discordcanary.exe", "discorddevelopment.exe",
            "vesktop.exe", "armcord.exe", "legcord.exe",
            "ts3client_win64.exe", "teamspeak.exe", "mumble.exe", "ventrilo.exe",
            "telacompartilhada.exe",
            "shellexperiencehost.exe", "startmenuexperiencehost.exe", "searchhost.exe",
            "searchapp.exe", "searchui.exe", "lockapp.exe", "taskmgr.exe",
            "dwm.exe", "csrss.exe", "svchost.exe", "sihost.exe", "ctfmon.exe",
            "textinputhost.exe", "systemsettings.exe", "applicationframehost.exe",
            "audiodg.exe", "conhost.exe", "dllhost.exe", "securityhealthsystray.exe",
            "gamebar.exe", "gamebarftserver.exe", "snippingtool.exe", "screenclippinghost.exe"
        };

        static readonly HashSet<string> IgnoredWindowClasses = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Progman", "WorkerW",
            "NotifyIconOverflowWindow", "TopLevelWindowForOverflowXamlIsland",
            "XamlExplorerHostIslandWindow", "MultitaskingViewFrame", "TaskListThumbnailWnd",
            "ForegroundStaging", "ApplicationManager_DesktopShellWindow"
        };

        struct ProcInfo
        {
            public uint Pid;
            public uint ParentPid;
            public string ExeName;
        }

        static volatile bool _running = true;
        static volatile string _captureMode = "active"; // "active" | "window"
        static long _fixedHwndValue = 0;
        static uint _selfPid = 0;

        static Dictionary<uint, ProcInfo> GetProcessMap()
        {
            var map = new Dictionary<uint, ProcInfo>();
            IntPtr snap = CreateToolhelp32Snapshot(0x00000002, 0);
            if (snap == IntPtr.Zero || snap == new IntPtr(-1)) return map;
            try
            {
                PROCESSENTRY32 pe = new PROCESSENTRY32();
                pe.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
                if (Process32First(snap, ref pe))
                {
                    do
                    {
                        map[pe.th32ProcessID] = new ProcInfo
                        {
                            Pid = pe.th32ProcessID,
                            ParentPid = pe.th32ParentProcessID,
                            ExeName = pe.szExeFile ?? ""
                        };
                    } while (Process32Next(snap, ref pe));
                }
            }
            finally
            {
                CloseHandle(snap);
            }
            return map;
        }

        static uint ResolveSameExeRootPid(uint pid, Dictionary<uint, ProcInfo> map)
        {
            uint cur = pid;
            int depth = 0;
            while (depth < 12)
            {
                ProcInfo curInfo;
                if (!map.TryGetValue(cur, out curInfo)) break;
                uint parentPid = curInfo.ParentPid;
                if (parentPid == 0 || parentPid == cur) break;
                ProcInfo parentInfo;
                if (!map.TryGetValue(parentPid, out parentInfo)) break;
                if (!string.Equals(parentInfo.ExeName, curInfo.ExeName, StringComparison.OrdinalIgnoreCase))
                    break;
                cur = parentPid;
                depth++;
            }
            return cur;
        }

        static bool IsRelatedToSelf(uint pid, Dictionary<uint, ProcInfo> map)
        {
            if (_selfPid == 0 || pid == 0) return false;
            uint selfRoot = ResolveSameExeRootPid(_selfPid, map);
            uint cur = pid;
            int depth = 0;
            while (cur != 0 && depth < 16)
            {
                if (cur == _selfPid || cur == selfRoot) return true;
                ProcInfo info;
                if (!map.TryGetValue(cur, out info)) break;
                if (info.ParentPid == cur) break;
                cur = info.ParentPid;
                depth++;
            }
            return false;
        }

        static uint ResolveWindowRootPid(IntPtr hwnd, Dictionary<uint, ProcInfo> map, out string exeName)
        {
            exeName = "";
            if (hwnd == IntPtr.Zero) return 0;
            uint pid;
            GetWindowThreadProcessId(hwnd, out pid);
            if (pid == 0) return 0;

            ProcInfo info;
            if (map.TryGetValue(pid, out info))
            {
                exeName = info.ExeName;
                if (string.Equals(exeName, "ApplicationFrameHost.exe", StringComparison.OrdinalIgnoreCase))
                {
                    uint childPid = 0;
                    EnumChildWindows(hwnd, (childHwnd, lParam) =>
                    {
                        uint cPid;
                        GetWindowThreadProcessId(childHwnd, out cPid);
                        if (cPid != 0 && cPid != pid)
                        {
                            childPid = cPid;
                            return false;
                        }
                        return true;
                    }, IntPtr.Zero);

                    if (childPid != 0 && map.TryGetValue(childPid, out info))
                    {
                        pid = childPid;
                        exeName = info.ExeName;
                    }
                }

                pid = ResolveSameExeRootPid(pid, map);
            }
            return pid;
        }

        static string GetWindowTitle(IntPtr hwnd)
        {
            var sb = new StringBuilder(256);
            GetWindowText(hwnd, sb, sb.Capacity);
            return sb.ToString().Replace("|", "-").Replace("\r", "").Replace("\n", "").Trim();
        }

        static string GetWindowClass(IntPtr hwnd)
        {
            var sb = new StringBuilder(128);
            GetClassName(hwnd, sb, sb.Capacity);
            return sb.ToString().Trim();
        }

        static bool IsWindowCloaked(IntPtr hwnd)
        {
            int cloaked = 0;
            int hr = DwmGetWindowAttribute(hwnd, 14, out cloaked, sizeof(int));
            return hr == 0 && cloaked != 0;
        }

        static bool IsCandidateWindowValid(IntPtr hwnd, Dictionary<uint, ProcInfo> map, bool allowEmptyTitle, out uint resolvedPid, out string exeName, out string title)
        {
            resolvedPid = 0;
            exeName = "";
            title = "";
            if (hwnd == IntPtr.Zero) return false;

            IntPtr rootHwnd = GetAncestor(hwnd, 2); // GA_ROOT
            if (rootHwnd != IntPtr.Zero) hwnd = rootHwnd;

            if (!IsWindowVisible(hwnd) || IsIconic(hwnd) || IsWindowCloaked(hwnd)) return false;

            if (!allowEmptyTitle)
            {
                int exStyle = GetWindowLong(hwnd, -20); // GWL_EXSTYLE
                if ((exStyle & 0x00000080) != 0) return false; // WS_EX_TOOLWINDOW
            }

            RECT rect;
            if (GetWindowRect(hwnd, out rect))
            {
                if ((rect.Right - rect.Left) < 100 || (rect.Bottom - rect.Top) < 80) return false;
            }

            string cls = GetWindowClass(hwnd);
            if (IgnoredWindowClasses.Contains(cls)) return false;

            title = GetWindowTitle(hwnd);
            if (string.IsNullOrEmpty(title) && !allowEmptyTitle) return false;

            resolvedPid = ResolveWindowRootPid(hwnd, map, out exeName);
            if (resolvedPid == 0 || string.IsNullOrEmpty(exeName)) return false;

            if (IgnoredProcesses.Contains(exeName)) return false;
            if (IsRelatedToSelf(resolvedPid, map)) return false;

            if (string.Equals(exeName, "explorer.exe", StringComparison.OrdinalIgnoreCase))
                return false;

            if (string.IsNullOrEmpty(title))
                title = exeName;

            return true;
        }

        static bool FindFallbackTopWindow(Dictionary<uint, ProcInfo> map, out uint resolvedPid, out string exeName, out string title)
        {
            resolvedPid = 0;
            exeName = "";
            title = "";

            IntPtr cur = GetTopWindow(IntPtr.Zero);
            int steps = 0;
            while (cur != IntPtr.Zero && steps < 120)
            {
                if (IsCandidateWindowValid(cur, map, false, out resolvedPid, out exeName, out title))
                {
                    return true;
                }
                cur = GetWindow(cur, 2); // GW_HWNDNEXT
                steps++;
            }
            return false;
        }

        static bool OpenProcessLoopback(uint targetPid, out IAudioClient client, out IAudioCaptureClient captureClient, out IntPtr clientPtr, out IntPtr capturePtr)
        {
            client = null;
            captureClient = null;
            clientPtr = IntPtr.Zero;
            capturePtr = IntPtr.Zero;

            var activationParams = new AUDIOCLIENT_ACTIVATION_PARAMS
            {
                ActivationType = 1,
                ProcessLoopbackParams = new AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS
                {
                    TargetProcessId = targetPid,
                    ProcessLoopbackMode = 0 // INCLUDE_TARGET_PROCESS_TREE
                }
            };

            int size = Marshal.SizeOf(activationParams);
            IntPtr blobPtr = Marshal.AllocHGlobal(size);
            try
            {
                Marshal.StructureToPtr(activationParams, blobPtr, false);
                var propVar = new PROPVARIANT
                {
                    vt = 65,
                    blob = new BLOB { cbSize = (uint)size, pBlobData = blobPtr }
                };

                var handler = new ActivateHandler();
                Guid iidAudioClient = new Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2");
                IntPtr opPtr;

                int hr = ActivateAudioInterfaceAsync("VAD\\Process_Loopback", ref iidAudioClient, ref propVar, handler, out opPtr);
                if (hr != 0) return false;

                if (!handler.DoneEvent.WaitOne(2500)) return false;
                if (handler.ActivateHr != 0 || handler.AudioClientPtr == IntPtr.Zero) return false;

                clientPtr = handler.AudioClientPtr;
                client = (IAudioClient)Marshal.GetObjectForIUnknown(clientPtr);

                var wfx = new WAVEFORMATEX
                {
                    wFormatTag = 1, // PCM 16-bit
                    nChannels = 2,
                    nSamplesPerSec = 48000,
                    wBitsPerSample = 16,
                    nBlockAlign = 4,
                    nAvgBytesPerSec = 48000 * 4,
                    cbSize = 0
                };

                // AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY
                uint flags = 0x00020000 | 0x80000000 | 0x08000000;
                int initHr = client.Initialize(0, flags, 200000, 0, ref wfx, IntPtr.Zero);
                if (initHr != 0) return false;

                Guid iidCapture = new Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317");
                int srvHr = client.GetService(ref iidCapture, out capturePtr);
                if (srvHr != 0 || capturePtr == IntPtr.Zero) return false;

                captureClient = (IAudioCaptureClient)Marshal.GetObjectForIUnknown(capturePtr);
                int startHr = client.Start();
                return startHr == 0;
            }
            catch
            {
                return false;
            }
            finally
            {
                Marshal.FreeHGlobal(blobPtr);
            }
        }

        static void CloseLoopback(ref IAudioClient client, ref IAudioCaptureClient captureClient, ref IntPtr clientPtr, ref IntPtr capturePtr)
        {
            try { if (client != null) client.Stop(); } catch { }
            try { if (captureClient != null) Marshal.ReleaseComObject(captureClient); } catch { }
            try { if (client != null) Marshal.ReleaseComObject(client); } catch { }
            try { if (capturePtr != IntPtr.Zero) Marshal.Release(capturePtr); } catch { }
            try { if (clientPtr != IntPtr.Zero) Marshal.Release(clientPtr); } catch { }
            client = null;
            captureClient = null;
            clientPtr = IntPtr.Zero;
            capturePtr = IntPtr.Zero;
        }

        static void EmitStatus(string state, uint pid, string exeName, string title)
        {
            try
            {
                Console.Error.WriteLine("STATUS|" + state + "|" + pid + "|" + (exeName ?? "") + "|" + (title ?? ""));
                Console.Error.Flush();
            }
            catch { }
        }

        [MTAThread]
        static void Main(string[] args)
        {
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--self-pid" && i + 1 < args.Length)
                    uint.TryParse(args[++i], out _selfPid);
                else if (args[i] == "--mode" && i + 1 < args.Length)
                    _captureMode = args[++i].ToLowerInvariant();
                else if (args[i] == "--hwnd" && i + 1 < args.Length)
                    long.TryParse(args[++i], out _fixedHwndValue);
            }

            if (_selfPid == 0)
            {
                _selfPid = (uint)Process.GetCurrentProcess().Id;
            }

            Thread stdinThread = new Thread(() =>
            {
                try
                {
                    string line;
                    while ((line = Console.In.ReadLine()) != null)
                    {
                        line = line.Trim();
                        if (line.Equals("STOP", StringComparison.OrdinalIgnoreCase))
                        {
                            _running = false;
                            break;
                        }
                        else if (line.Equals("ACTIVE", StringComparison.OrdinalIgnoreCase))
                        {
                            Interlocked.Exchange(ref _fixedHwndValue, 0);
                            _captureMode = "active";
                        }
                        else if (line.StartsWith("WINDOW ", StringComparison.OrdinalIgnoreCase))
                        {
                            long hVal;
                            if (long.TryParse(line.Substring(7).Trim(), out hVal))
                            {
                                Interlocked.Exchange(ref _fixedHwndValue, hVal);
                                _captureMode = "window";
                            }
                        }
                    }
                }
                catch { }
                _running = false;
            });
            stdinThread.IsBackground = true;
            stdinThread.Start();

            Stream stdout = Console.OpenStandardOutput();
            byte[] workBuffer = new byte[65536];
            byte[] silentBuffer = new byte[8192];

            IAudioClient client = null;
            IAudioCaptureClient captureClient = null;
            IntPtr clientPtr = IntPtr.Zero;
            IntPtr capturePtr = IntPtr.Zero;

            uint currentTargetPid = 0;
            string currentExeName = "";
            string currentTitle = "";
            long lastTargetCheckMs = -1000;
            var sw = Stopwatch.StartNew();

            while (_running)
            {
                long nowMs = sw.ElapsedMilliseconds;
                if (nowMs - lastTargetCheckMs >= 160 || currentTargetPid == 0)
                {
                    lastTargetCheckMs = nowMs;
                    var map = GetProcessMap();
                    string mode = _captureMode;
                    long fixedHwnd = Interlocked.Read(ref _fixedHwndValue);

                    uint desiredPid = currentTargetPid;
                    string desiredExe = currentExeName;
                    string desiredTitle = currentTitle;

                    if (mode == "window" && fixedHwnd != 0)
                    {
                        IntPtr targetHwnd = new IntPtr(fixedHwnd);
                        string resolvedExe;
                        uint resolvedPid = ResolveWindowRootPid(targetHwnd, map, out resolvedExe);
                        if (resolvedPid != 0)
                        {
                            desiredPid = resolvedPid;
                            desiredExe = resolvedExe;
                            string t = GetWindowTitle(targetHwnd);
                            if (!string.IsNullOrEmpty(t)) desiredTitle = t;
                            else if (string.IsNullOrEmpty(desiredTitle)) desiredTitle = resolvedExe;
                        }
                        else if (currentTargetPid != 0 && !map.ContainsKey(currentTargetPid))
                        {
                            desiredPid = 0;
                        }
                    }
                    else
                    {
                        // Active window mode: track foreground window, ignore Discord & self
                        IntPtr fgHwnd = GetForegroundWindow();
                        uint candPid;
                        string candExe, candTitle;
                        if (IsCandidateWindowValid(fgHwnd, map, true, out candPid, out candExe, out candTitle))
                        {
                            desiredPid = candPid;
                            desiredExe = candExe;
                            desiredTitle = candTitle;
                        }
                        else
                        {
                            // Foreground is Discord, TelaCompartilhada, or Desktop/Taskbar:
                            // Keep previous valid PID if still alive; otherwise find top Z-order window
                            if (currentTargetPid == 0 || !map.ContainsKey(currentTargetPid))
                            {
                                if (FindFallbackTopWindow(map, out candPid, out candExe, out candTitle))
                                {
                                    desiredPid = candPid;
                                    desiredExe = candExe;
                                    desiredTitle = candTitle;
                                }
                                else
                                {
                                    desiredPid = 0;
                                }
                            }
                        }
                    }

                    if (desiredPid != currentTargetPid)
                    {
                        CloseLoopback(ref client, ref captureClient, ref clientPtr, ref capturePtr);
                        currentTargetPid = 0;
                        currentExeName = "";
                        currentTitle = "";

                        if (desiredPid != 0)
                        {
                            if (OpenProcessLoopback(desiredPid, out client, out captureClient, out clientPtr, out capturePtr))
                            {
                                currentTargetPid = desiredPid;
                                currentExeName = desiredExe;
                                currentTitle = desiredTitle;
                                EmitStatus("ACTIVE", currentTargetPid, currentExeName, currentTitle);
                            }
                            else
                            {
                                EmitStatus("WAITING", 0, "", "Aguardando janela com som...");
                            }
                        }
                        else
                        {
                            EmitStatus("WAITING", 0, "", "Aguardando janela ativa...");
                        }
                    }
                    else if (currentTargetPid != 0 && desiredTitle != currentTitle && !string.IsNullOrEmpty(desiredTitle))
                    {
                        currentTitle = desiredTitle;
                        EmitStatus("ACTIVE", currentTargetPid, currentExeName, currentTitle);
                    }
                }

                if (captureClient != null)
                {
                    uint packetSize = 0;
                    int phr = captureClient.GetNextPacketSize(out packetSize);
                    if (phr < 0)
                    {
                        CloseLoopback(ref client, ref captureClient, ref clientPtr, ref capturePtr);
                        currentTargetPid = 0;
                        continue;
                    }

                    while (packetSize > 0 && _running)
                    {
                        IntPtr dataPtr;
                        uint numFrames, flags;
                        ulong devPos, qpcPos;
                        int ghr = captureClient.GetBuffer(out dataPtr, out numFrames, out flags, out devPos, out qpcPos);
                        if (ghr != 0) break;

                        int byteCount = (int)(numFrames * 4);
                        if (byteCount > 0)
                        {
                            bool isSilent = (flags & 0x2) != 0; // AUDCLNT_BUFFERFLAGS_SILENT
                            if (isSilent)
                            {
                                int rem = byteCount;
                                while (rem > 0)
                                {
                                    int chunk = Math.Min(rem, silentBuffer.Length);
                                    stdout.Write(silentBuffer, 0, chunk);
                                    rem -= chunk;
                                }
                            }
                            else
                            {
                                if (workBuffer.Length < byteCount)
                                    workBuffer = new byte[byteCount];
                                Marshal.Copy(dataPtr, workBuffer, 0, byteCount);
                                stdout.Write(workBuffer, 0, byteCount);
                            }
                            stdout.Flush();
                        }

                        captureClient.ReleaseBuffer(numFrames);
                        if (captureClient.GetNextPacketSize(out packetSize) != 0)
                            break;
                    }
                }

                Thread.Sleep(5);
            }

            CloseLoopback(ref client, ref captureClient, ref clientPtr, ref capturePtr);
        }
    }
}
