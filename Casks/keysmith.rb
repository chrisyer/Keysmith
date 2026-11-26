cask "keysmith" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.2"
  sha256 arm:   "bd092733507c5a7111d056cccd27fd43fa5d3d419898dc123e853047afdecaa7",
         intel: "e2e44e991d4343542e6bedb906dc9cb0ada0901899b61ef624c3466535206f63"

  url "https://github.com/chrisyer/Keysmith/releases/download/v#{version}/Keysmith_#{version}_#{arch}.dmg"
  name "Keysmith"
  desc "Zero-knowledge Vaultwarden password & passkey manager for macOS"
  homepage "https://github.com/chrisyer/Keysmith"

  depends_on macos: ">= :ventura"

  app "Keysmith.app"

  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-cr", "#{appdir}/Keysmith.app"],
                   sudo: false
  end

  zap trash: [
    "~/Library/Application Support/dev.keysmith.desktop",
    "~/Library/Preferences/dev.keysmith.desktop.plist",
    "~/Library/Caches/dev.keysmith.desktop",
  ]
end
