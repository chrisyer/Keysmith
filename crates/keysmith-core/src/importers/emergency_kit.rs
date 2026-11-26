use std::fmt::Write as _;

pub struct EmergencyKitInput {
    pub email: String,
    pub display_name: String,
    pub server_url: String,
    pub kdf_label: String,
    pub account_id: String,
    pub generated_at: String,
}

fn pdf_escape(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len() + 8);
    for ch in raw.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '(' => out.push_str("\\("),
            ')' => out.push_str("\\)"),
            '\r' | '\n' => out.push(' '),
            c if (' '..='~').contains(&c) => out.push(c),
            _ => out.push('?'),
        }
    }
    out
}

fn truncate_ascii(raw: &str, max_len: usize) -> String {
    let clean: String = raw
        .chars()
        .map(|c| if (' '..='~').contains(&c) { c } else { '?' })
        .collect();
    if clean.len() <= max_len {
        clean
    } else {
        format!("{}...", &clean[..max_len.saturating_sub(3)])
    }
}

/// Pure-Rust printable A4 PDF 1.4 Emergency Kit generator (zero external dependencies).
pub fn generate_emergency_kit_pdf(input: &EmergencyKitInput) -> Vec<u8> {
    let mut s = String::with_capacity(4096);

    // Top header banner (#0572EC)
    let _ = writeln!(s, "0.02 0.45 0.93 rg 36 756 523 54 re f");
    let _ = writeln!(s, "BT /F2 20 Tf 1 1 1 rg 54 780 Td (KEYSMITH EMERGENCY KIT) Tj ET");
    let _ = writeln!(
        s,
        "BT /F1 9.5 Tf 0.88 0.94 1 rg 54 765 Td (Zero-Knowledge Vault Recovery Sheet  |  Keep Offline in a Secure Safe) Tj ET"
    );

    // Security notice box
    let _ = writeln!(s, "1 0.97 0.92 rg 0.95 0.62 0.12 RG 1 w 36 694 523 48 re B");
    let _ = writeln!(
        s,
        "BT /F2 10.5 Tf 0.65 0.32 0.02 rg 50 724 Td (IMPORTANT SECURITY NOTICE) Tj ET"
    );
    let _ = writeln!(
        s,
        "BT /F1 9.2 Tf 0.35 0.22 0.08 rg 50 708 Td (Anyone with this sheet and your Master Password can access your vault. Print it and store it in a physical safe.) Tj ET"
    );

    // Section 1: Account Configuration
    let _ = writeln!(s, "0.96 0.97 0.99 rg 0.82 0.85 0.90 RG 0.8 w 36 520 523 156 re B");
    let _ = writeln!(
        s,
        "BT /F2 12 Tf 0.08 0.12 0.20 rg 50 654 Td (1. Account & Server Credentials) Tj ET"
    );

    let rows = [
        ("Account Holder:", truncate_ascii(&input.display_name, 64)),
        ("Email Address:", truncate_ascii(&input.email, 64)),
        ("Vault Server URL:", truncate_ascii(&input.server_url, 64)),
        ("KDF Encryption:", truncate_ascii(&input.kdf_label, 64)),
        ("Account ID:", truncate_ascii(&input.account_id, 64)),
        ("Generated At:", truncate_ascii(&input.generated_at, 64)),
    ];

    for (idx, (label, val)) in rows.iter().enumerate() {
        let y = 630 - (idx as i32) * 18;
        let _ = writeln!(
            s,
            "BT /F2 9.5 Tf 0.35 0.40 0.48 rg 50 {y} Td ({}) Tj ET",
            pdf_escape(label)
        );
        let _ = writeln!(
            s,
            "BT /F3 9.8 Tf 0.06 0.09 0.16 rg 165 {y} Td ({}) Tj ET",
            pdf_escape(val)
        );
    }

    // Section 2: Master Password write-in box
    let _ = writeln!(s, "1 1 1 rg 0.12 0.45 0.90 RG 1.2 w 36 376 523 126 re B");
    let _ = writeln!(
        s,
        "BT /F2 12 Tf 0.08 0.12 0.20 rg 50 480 Td (2. Master Password  \\(Write by Hand After Printing\\)) Tj ET"
    );
    let _ = writeln!(
        s,
        "BT /F1 9 Tf 0.40 0.45 0.52 rg 50 464 Td (Keysmith uses zero-knowledge encryption. Neither Keysmith nor your server operator can reset this password.) Tj ET"
    );
    // Write-in lines
    let _ = writeln!(s, "0.75 0.80 0.88 RG 0.8 w 50 426 m 545 426 l S");
    let _ = writeln!(s, "0.75 0.80 0.88 RG 0.8 w 50 394 m 545 394 l S");

    // Section 3: 2FA Recovery Codes / Backup Passphrase write-in box
    let _ = writeln!(s, "1 1 1 rg 0.82 0.85 0.90 RG 0.8 w 36 226 523 132 re B");
    let _ = writeln!(
        s,
        "BT /F2 12 Tf 0.08 0.12 0.20 rg 50 336 Td (3. Two-Factor Recovery Code & Encrypted Backup Passphrase) Tj ET"
    );
    let _ = writeln!(
        s,
        "BT /F1 9 Tf 0.40 0.45 0.52 rg 50 318 Td (Server 2FA Recovery Code:) Tj ET"
    );
    let _ = writeln!(s, "0.78 0.82 0.88 RG 0.7 w 185 316 m 545 316 l S");
    let _ = writeln!(
        s,
        "BT /F1 9 Tf 0.40 0.45 0.52 rg 50 284 Td (Backup File Passphrase:) Tj ET"
    );
    let _ = writeln!(s, "0.78 0.82 0.88 RG 0.7 w 185 282 m 545 282 l S");
    let _ = writeln!(
        s,
        "BT /F1 9 Tf 0.40 0.45 0.52 rg 50 250 Td (Physical Backup Location:) Tj ET"
    );
    let _ = writeln!(s, "0.78 0.82 0.88 RG 0.7 w 185 248 m 545 248 l S");

    // Section 4: Disaster Recovery Checklist
    let _ = writeln!(s, "0.97 0.98 0.99 rg 0.84 0.87 0.92 RG 0.8 w 36 74 523 134 re B");
    let _ = writeln!(
        s,
        "BT /F2 11.5 Tf 0.08 0.12 0.20 rg 50 186 Td (4. Disaster Recovery Checklist) Tj ET"
    );
    let steps = [
        "[ ] Install Keysmith Desktop on macOS or Windows and select your Vault Server URL above.",
        "[ ] Sign in using your Email Address, handwritten Master Password, and 2FA / Recovery Code.",
        "[ ] If restoring offline, open Settings -> Import / Export -> Keysmith Encrypted JSON or Snapshots.",
        "[ ] Destroy old Emergency Kits securely whenever you rotate your Master Password.",
    ];
    for (idx, line) in steps.iter().enumerate() {
        let y = 164 - (idx as i32) * 20;
        let _ = writeln!(
            s,
            "BT /F1 9.2 Tf 0.20 0.25 0.33 rg 50 {y} Td ({}) Tj ET",
            pdf_escape(line)
        );
    }

    let _ = writeln!(
        s,
        "BT /F1 8 Tf 0.52 0.56 0.64 rg 36 46 Td (Generated locally by Keysmith Zero-Knowledge Engine  |  No data left your device) Tj ET"
    );

    let stream_bytes = s.into_bytes();

    let objects: Vec<Vec<u8>> = vec![
        b"<< /Type /Catalog /Pages 2 0 R >>".to_vec(),
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_vec(),
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> >> /Contents 7 0 R >>".to_vec(),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>".to_vec(),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>".to_vec(),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>".to_vec(),
        {
            let mut obj = format!("<< /Length {} >>\nstream\n", stream_bytes.len()).into_bytes();
            obj.extend_from_slice(&stream_bytes);
            obj.extend_from_slice(b"endstream");
            obj
        },
    ];

    let mut pdf = Vec::with_capacity(stream_bytes.len() + 1024);
    pdf.extend_from_slice(b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

    let mut offsets = Vec::with_capacity(objects.len());
    for (idx, body) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.extend_from_slice(format!("{} 0 obj\n", idx + 1).as_bytes());
        pdf.extend_from_slice(body);
        pdf.extend_from_slice(b"\nendobj\n");
    }

    let xref_offset = pdf.len();
    pdf.extend_from_slice(format!("xref\n0 {}\n", objects.len() + 1).as_bytes());
    pdf.extend_from_slice(b"0000000000 65535 f \n");
    for off in offsets {
        pdf.extend_from_slice(format!("{off:010} 00000 n \n").as_bytes());
    }
    pdf.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n",
            objects.len() + 1
        )
        .as_bytes(),
    );

    pdf
}
