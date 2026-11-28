cask "keysmith" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.5"
  sha256 arm:   "660f28c72c781513c4846b07b3cd24f6b7a430e9f48c4ac394b025e1bca8d9cf",
         intel: "371c65cf5028eb1bb98fef9d564bc5f9e0080b1a413faf4e0722de0771917a16"

  url "https://github.com/chrisyer/Keysmith/releases/download/v#{version}/Keysmith_#{version}_#{arch}.dmg"
  name "Keysmith"
  desc "Zero-knowledge Vaultwarden password & passkey manager for macOS"
  homepage "https://github.com/chrisyer/Keysmith"

  depends_on macos: ">= :ventura"

  app "Keysmith.app"

  caveats <<~EOS
    Keysmith releases are currently ad-hoc signed without Apple Developer notarization.
    If macOS Gatekeeper blocks first launch, approve it in:
      System Settings -> Privacy & Security -> Open Anyway
    Or run manually after verifying the checksum:
      xattr -dr com.apple.quarantine "#{appdir}/Keysmith.app"
  EOS

  zap trash: [
    "~/Library/Application Support/dev.keysmith.desktop",
    "~/Library/Preferences/dev.keysmith.desktop.plist",
    "~/Library/Caches/dev.keysmith.desktop",
  ]
end
