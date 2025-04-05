# QbistJS

This is a JavaScript port of the Qbist plugin for gimp written in C. When I first used Gimp in around 2014 or so, I loved the fun and abstract generations that you could create with the plugin. I always wanted to dig in and understand how the algorithm behind it, and I finally got around to it. I'm porting it to Javascript so that anyone can run it in the browser without having to download the entire Gimp application just to make some cool abstract art (not that you shouldn't use Gimp, go check that out if you want a free and open source image editor!).

## Try it out

Hosting link here! (TODO)

# Info from the original source code:

Source code can be found here: https://github.com/GNOME/gimp/blob/master/plug-ins/common/qbist.c

Written 1997 Jens Ch. Restemeier <jrestemeier@currantbun.com>
This program is based on an algorithm / article by
Jörn Loviscach.

It appeared in c't 10/95, page 326 and is called
"Ausgewürfelt - Moderne Kunst algorithmisch erzeugen"
(~modern art created with algorithms).

It generates one main formula (the middle button) and 8 variations of it.
If you select a variation it becomes the new main formula. If you
press "OK" the main formula will be applied to the image.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation; either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
