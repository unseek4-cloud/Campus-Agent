using System;
using System.IO;

internal static class Program
{
    private const int WdExportFormatPdf = 17;

    private static int Main(string[] args)
    {
        string outDir = null;
        string convertTo = null;
        string inputPath = null;

        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "--outdir" && i + 1 < args.Length)
            {
                outDir = args[++i];
            }
            else if (args[i] == "--convert-to" && i + 1 < args.Length)
            {
                convertTo = args[++i];
            }
            else if (File.Exists(args[i]))
            {
                inputPath = args[i];
            }
        }

        if (!string.Equals(convertTo, "pdf", StringComparison.OrdinalIgnoreCase))
        {
            Console.Error.WriteLine("The Word rendering shim supports PDF output only.");
            return 2;
        }

        if (string.IsNullOrWhiteSpace(outDir) || string.IsNullOrWhiteSpace(inputPath))
        {
            Console.Error.WriteLine("Missing output directory or input document.");
            return 3;
        }

        Directory.CreateDirectory(outDir);
        string outputPath = Path.Combine(
            outDir,
            Path.GetFileNameWithoutExtension(inputPath) + ".pdf"
        );

        Type wordType = Type.GetTypeFromProgID("Word.Application");
        if (wordType == null)
        {
            Console.Error.WriteLine("Microsoft Word is not installed.");
            return 4;
        }

        dynamic word = null;
        dynamic document = null;
        try
        {
            word = Activator.CreateInstance(wordType);
            word.Visible = false;
            word.DisplayAlerts = 0;
            document = word.Documents.Open(
                Path.GetFullPath(inputPath),
                ReadOnly: true,
                AddToRecentFiles: false,
                Visible: false
            );
            document.ExportAsFixedFormat(outputPath, WdExportFormatPdf);
            Console.WriteLine("Converted " + inputPath + " to " + outputPath);
            return File.Exists(outputPath) && new FileInfo(outputPath).Length > 0 ? 0 : 5;
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine(exception.ToString());
            return 6;
        }
        finally
        {
            if (document != null)
            {
                try { document.Close(false); } catch { }
            }
            if (word != null)
            {
                try { word.Quit(false); } catch { }
            }
        }
    }
}
