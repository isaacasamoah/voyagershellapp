# A private interactive Bash, owned by Voyager. Never edits the user's dotfiles.
# FD 9 is an event channel separate from the displayed terminal byte stream.
HISTFILE=/dev/null
HISTCONTROL=
HISTIGNORE=
HISTSIZE=1000
set -o history
history -c
__voyager_prompt() {
    local status=$?
    printf 'end\0%s\0%s\0' "$status" "$PWD" >&9
}
PS0='$(printf "begin\0%s\0%s\0" "$(HISTTIMEFORMAT= builtin history 1)" "$PWD" >&9)'
PROMPT_COMMAND=__voyager_prompt
PS1='\w \$ '
