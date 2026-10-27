using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace Barracks.Qualification {
    // Qualification host only. A Job Object manages lifetime, not filesystem permissions.
    public sealed class OwnedJob : IDisposable {
        [StructLayout(LayoutKind.Sequential)] struct Limits {
            public long PerProcessUserTime, PerJobUserTime;
            public uint Flags;
            public UIntPtr MinWorkingSet, MaxWorkingSet;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass, SchedulingClass;
        }
        [StructLayout(LayoutKind.Sequential)] struct Counters {
            public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
        }
        [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
            public Limits Basic;
            public Counters Io;
            public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemory, PeakJobMemory;
        }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct Startup {
            public uint Size;
            public string Reserved, Desktop, Title;
            public uint X, Y, XSize, YSize, XChars, YChars, Fill, Flags;
            public ushort ShowWindow, ReservedSize;
            public IntPtr ReservedBytes, Input, Output, Error;
        }
        [StructLayout(LayoutKind.Sequential)] struct ProcessInfo {
            public IntPtr Process, Thread;
            public uint ProcessId, ThreadId;
        }
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern IntPtr CreateJobObject(IntPtr attributes, string name);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool SetInformationJobObject(IntPtr job, int type, ref ExtendedLimits value, uint size);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool QueryInformationJobObject(IntPtr job, int type, IntPtr value, uint size, out uint needed);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool CreateProcess(string executable, StringBuilder command, IntPtr processAttributes,
            IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string cwd,
            ref Startup startup, out ProcessInfo process);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
        [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint code);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint code);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
        IntPtr handle;
        public OwnedJob() {
            handle = CreateJobObject(IntPtr.Zero, null);
            if (handle == IntPtr.Zero) throw new Win32Exception();
            var limits = new ExtendedLimits();
            limits.Basic.Flags = 0x2000; // KILL_ON_JOB_CLOSE; no breakaway flags.
            if (!SetInformationJobObject(handle, 9, ref limits, (uint)Marshal.SizeOf(limits))) {
                int error = Marshal.GetLastWin32Error(); Dispose(); throw new Win32Exception(error);
            }
        }
        public uint Start(string executable, string commandLine, string cwd) {
            var startup = new Startup(); startup.Size = (uint)Marshal.SizeOf(startup);
            ProcessInfo process;
            if (!CreateProcess(executable, new StringBuilder(commandLine), IntPtr.Zero, IntPtr.Zero,
                false, 0x08000004, IntPtr.Zero, cwd, ref startup, out process)) throw new Win32Exception();
            try {
                if (!AssignProcessToJobObject(handle, process.Process)) throw new Win32Exception();
                if (ResumeThread(process.Thread) == 0xffffffff) throw new Win32Exception();
                return process.ProcessId;
            } catch {
                TerminateProcess(process.Process, 1); throw;
            } finally { CloseHandle(process.Thread); CloseHandle(process.Process); }
        }
        public long[] Members() {
            IntPtr buffer = Marshal.AllocHGlobal(65536);
            try {
                uint needed;
                if (!QueryInformationJobObject(handle, 3, buffer, 65536, out needed)) throw new Win32Exception();
                int count = Marshal.ReadInt32(buffer, 4);
                if (count < 0 || count > (65536 - 8) / IntPtr.Size) throw new InvalidOperationException("Job member count exceeds buffer.");
                var members = new long[count];
                for (int i = 0; i < count; i++) members[i] = Marshal.ReadIntPtr(buffer, 8 + i * IntPtr.Size).ToInt64();
                return members;
            } finally { Marshal.FreeHGlobal(buffer); }
        }
        public void Cancel() { if (!TerminateJobObject(handle, 1)) throw new Win32Exception(); }
        public void Dispose() { if (handle != IntPtr.Zero) { CloseHandle(handle); handle = IntPtr.Zero; } }
    }
}
