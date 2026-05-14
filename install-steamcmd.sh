#!/bin/bash
# Install SteamCMD for Assetto Corsa content download

echo "Installing SteamCMD..."

# Install dependencies
echo "Porx_31245" | sudo -S apt update
echo "Porx_31245" | sudo -S apt install -y gnupg2 wget

# Download and extract steamcmd
echo "Porx_31245" | sudo -S mkdir -p /usr/games/steamcmd
cd /tmp
wget -q https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz
echo "Porx_31245" | sudo -S tar -xzf steamcmd_linux.tar.gz -C /usr/games/steamcmd
echo "Porx_31245" | sudo -S chown -R jose:jose /usr/games/steamcmd

# Create symlink
echo "Porx_31245" | sudo -S ln -sf /usr/games/steamcmd/steamcmd.sh /usr/local/bin/steamcmd

# Test
steamcmd +quit

echo "SteamCMD installed at /usr/games/steamcmd"