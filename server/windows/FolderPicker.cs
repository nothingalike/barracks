using System;
using System.IO;
using System.Runtime.InteropServices;

public static class BarracksFolderPicker {
  [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
  private class FileOpenDialog {}
  [ComImport, Guid("42F85136-DB7E-439C-85F1-E4075D135FC8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IFileDialog {
    [PreserveSig] int Show(IntPtr owner);
    void SetFileTypes(uint count, IntPtr filters);
    void SetFileTypeIndex(uint index);
    void GetFileTypeIndex(out uint index);
    void Advise(IntPtr events, out uint cookie);
    void Unadvise(uint cookie);
    void SetOptions(uint options);
    void GetOptions(out uint options);
    void SetDefaultFolder(IShellItem item);
    void SetFolder(IShellItem item);
    void GetFolder(out IShellItem item);
    void GetCurrentSelection(out IShellItem item);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void GetResult(out IShellItem item);
    void AddPlace(IShellItem item, int location);
    void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string extension);
    void Close(int result);
    void SetClientGuid(ref Guid guid);
    void ClearClientData();
    void SetFilter(IntPtr filter);
  }
  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IShellItem {
    void BindToHandler(IntPtr context, ref Guid handler, ref Guid iid, out IntPtr value);
    void GetParent(out IShellItem parent);
    void GetDisplayName(uint format, out IntPtr name);
    void GetAttributes(uint mask, out uint attributes);
    void Compare(IShellItem other, uint hint, out int order);
  }
  [DllImport("shell32.dll", CharSet=CharSet.Unicode, PreserveSig=false)]
  private static extern void SHCreateItemFromParsingName(string path, IntPtr context, ref Guid iid, out IShellItem item);
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();

  public static string Choose(string initial, bool validateOnly) {
    var dialog=(IFileDialog)new FileOpenDialog();
    IShellItem initialItem=null, selected=null;
    IntPtr name=IntPtr.Zero;
    try {
      // Pick an existing filesystem folder with the standard Explorer dialog.
      dialog.SetOptions(0x20 | 0x40 | 0x800 | 0x8 | 0x02000000);
      dialog.SetTitle("Choose project folder");
      dialog.SetOkButtonLabel("Select folder");
      if(!String.IsNullOrWhiteSpace(initial) && Directory.Exists(initial)) {
        var iid=typeof(IShellItem).GUID;
        SHCreateItemFromParsingName(Path.GetFullPath(initial),IntPtr.Zero,ref iid,out initialItem);
        dialog.SetFolder(initialItem);
      }
      if(validateOnly) return "configured";
      var result=dialog.Show(GetForegroundWindow());
      if(result==unchecked((int)0x800704C7)) return null;
      Marshal.ThrowExceptionForHR(result);
      dialog.GetResult(out selected);
      selected.GetDisplayName(0x80058000,out name); // SIGDN_FILESYSPATH
      return Marshal.PtrToStringUni(name);
    } finally {
      if(name!=IntPtr.Zero) Marshal.FreeCoTaskMem(name);
      if(selected!=null) Marshal.ReleaseComObject(selected);
      if(initialItem!=null) Marshal.ReleaseComObject(initialItem);
      Marshal.ReleaseComObject(dialog);
    }
  }
}
