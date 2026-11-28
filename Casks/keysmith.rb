cask "keysmith" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.6"
  sha256 arm:   "c18290508304d338d48ebf87e912514cd5ce25df84642686c1284d578b8a8dad",
         intel: "563f7c2fa3287c120eb454115a5339e69836936bdf00a8e72af57dd73c2cf2cd"

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
